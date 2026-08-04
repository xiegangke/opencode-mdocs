import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

export const COMPLEXITY_LEVELS = ['simple', 'standard', 'complex'] as const;
export const ROUTE_AGENT_PREFIX = 'mdocs-route-';

export type ComplexityLevel = typeof COMPLEXITY_LEVELS[number];

export interface ClassificationResult {
  level: ComplexityLevel;
  reasons: string[];
}

export interface ModelBindingTarget {
  model: string;
  variant?: string;
}

export interface AgentBindingTarget {
  agent: string;
}

export type BindingTarget = ModelBindingTarget | AgentBindingTarget;

export interface RoutingConfig {
  schemaVersion: 1;
  defaultLevel: ComplexityLevel;
  levels: Record<ComplexityLevel, string[]>;
  bindings: Record<string, BindingTarget>;
  overrides?: {
    allowedLevels?: ComplexityLevel[];
    allowedBindings?: string[];
  };
}

export interface RouteOverride {
  source: 'tui';
  level?: string;
  binding?: string;
}

export interface RouteCandidate {
  readonly binding: string;
  readonly agent: string;
  readonly model: string;
  readonly variant?: string;
  readonly attemptIndex: number;
}

export interface RouteDecision {
  readonly classifiedLevel: ComplexityLevel;
  readonly reasons: readonly string[];
  readonly effectiveLevel: ComplexityLevel;
  readonly bindingOrder: readonly string[];
  readonly selectedBinding: string;
  readonly agent: string;
  readonly attemptIndex: number;
  readonly configHash: string;
  readonly override?: {
    readonly type: 'level' | 'binding';
    readonly value: string;
    readonly source: 'tui';
  };
}

export interface ResolvedRoute {
  readonly status: 'resolved';
  readonly decision: RouteDecision;
  readonly candidates: readonly RouteCandidate[];
  readonly nextAttempt: RouteCandidate | null;
  readonly diagnostics: readonly string[];
}

export interface DefaultHostRoute {
  readonly status: 'fallback';
  readonly fallback: 'default-host';
  readonly decision: null;
  readonly diagnostics: readonly string[];
  readonly routing: RoutingStatus;
}

export type RouteResolution = ResolvedRoute | DefaultHostRoute;

interface ParsedRouting {
  status: 'configured';
  path: string;
  config: RoutingConfig;
  configHash: string;
}

type RoutingLoadResult =
  | { status: 'disabled'; path: string }
  | { status: 'invalid'; path: string; errors: string[] }
  | ParsedRouting;

interface ActiveRouting {
  config: RoutingConfig;
  configHash: string;
  bindings: Record<string, RouteCandidate>;
  generatedAgents: string[];
}

export interface RoutingStatus {
  readonly path: string;
  readonly configured: boolean;
  readonly active: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly configHash?: string;
  readonly defaultLevel?: ComplexityLevel;
  readonly levels?: Readonly<Record<ComplexityLevel, readonly string[]>>;
  readonly generatedAgents: readonly string[];
}

const nonEmptyString = z.string().trim().min(1);
const bindingName = z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,62}$/);
const level = z.enum(COMPLEXITY_LEVELS);
const modelTarget = z.object({
  model: nonEmptyString,
  variant: nonEmptyString.optional()
}).strict();
const agentTarget = z.object({ agent: nonEmptyString }).strict();

const routingSchema = z.object({
  schemaVersion: z.literal(1),
  defaultLevel: level,
  levels: z.object({
    simple: z.array(bindingName).min(1),
    standard: z.array(bindingName).min(1),
    complex: z.array(bindingName).min(1)
  }).strict(),
  bindings: z.record(bindingName, z.union([modelTarget, agentTarget])),
  overrides: z.object({
    allowedLevels: z.array(level).optional(),
    allowedBindings: z.array(bindingName).optional()
  }).strict().optional()
}).strict().superRefine((config, context) => {
  for (const complexity of COMPLEXITY_LEVELS) {
    const names = config.levels[complexity];
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['levels', complexity],
        message: 'must not contain duplicate bindings'
      });
    }
    for (const name of names) {
      if (!config.bindings[name]) {
        context.addIssue({
          code: 'custom',
          path: ['levels', complexity],
          message: `references unknown binding "${name}"`
        });
      }
    }
  }

  const allowedLevels = config.overrides?.allowedLevels;
  if (allowedLevels && new Set(allowedLevels).size !== allowedLevels.length) {
    context.addIssue({ code: 'custom', path: ['overrides', 'allowedLevels'], message: 'must not contain duplicates' });
  }

  const allowedBindings = config.overrides?.allowedBindings;
  if (allowedBindings) {
    if (new Set(allowedBindings).size !== allowedBindings.length) {
      context.addIssue({ code: 'custom', path: ['overrides', 'allowedBindings'], message: 'must not contain duplicates' });
    }
    for (const name of allowedBindings) {
      if (!config.bindings[name]) {
        context.addIssue({
          code: 'custom',
          path: ['overrides', 'allowedBindings'],
          message: `references unknown binding "${name}"`
        });
      }
    }
  }
});

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function formatZodErrors(error: z.ZodError): string[] {
  return error.issues.map(issue => {
    const location = issue.path.length > 0 ? issue.path.join('.') : 'routing.json';
    return `${location}: ${issue.message}`;
  });
}

function loadRoutingConfig(baseDir: string): RoutingLoadResult {
  const filePath = path.join(baseDir, 'mdocs', 'routing.json');
  if (!fs.existsSync(filePath)) return { status: 'disabled', path: filePath };

  let input: unknown;
  try {
    input = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      status: 'invalid',
      path: filePath,
      errors: [`routing.json: invalid JSON: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  const result = routingSchema.safeParse(input);
  if (!result.success) {
    return { status: 'invalid', path: filePath, errors: formatZodErrors(result.error) };
  }

  return {
    status: 'configured',
    path: filePath,
    config: result.data,
    configHash: crypto.createHash('sha256').update(stableStringify(result.data)).digest('hex')
  };
}

const generatedAgentPrompt = [
  'You are an execution subagent selected by the deterministic Mdocs router.',
  'Follow the task and verification criteria from the orchestrator. Do not select or change the model, variant, Agent, or binding.',
  'If the task cannot continue safely, report the facts, side effects already produced, and blockers.'
].join('\n');

function generatedAgentDefinition(target: ModelBindingTarget) {
  return {
    description: 'Executes work selected by the deterministic Mdocs complexity router.',
    mode: 'subagent',
    model: target.model,
    ...(target.variant ? { variant: target.variant } : {}),
    prompt: generatedAgentPrompt
  };
}

function managedGeneratedAgentDefinition(definition: Record<string, any>) {
  return {
    description: definition.description,
    mode: definition.mode,
    model: definition.model,
    variant: definition.variant,
    prompt: definition.prompt,
    disable: definition.disable === true
  };
}

function parseClassification(
  value: unknown,
  defaultLevel: ComplexityLevel
): { classification: ClassificationResult; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      classification: { level: defaultLevel, reasons: [] },
      diagnostics: ['Classification is missing or invalid; defaultLevel was used']
    };
  }

  const record = value as Record<string, unknown>;
  const extraFields = Object.keys(record).filter(key => key !== 'level' && key !== 'reasons');
  if (extraFields.length > 0) {
    diagnostics.push(`Classification protocol violation: ignored fields ${extraFields.join(', ')}`);
  }
  if (!COMPLEXITY_LEVELS.includes(record.level as ComplexityLevel) ||
      !Array.isArray(record.reasons) ||
      !record.reasons.every(reason => typeof reason === 'string')) {
    diagnostics.push('Classification is missing or invalid; defaultLevel was used');
    return { classification: { level: defaultLevel, reasons: [] }, diagnostics };
  }

  return {
    classification: { level: record.level as ComplexityLevel, reasons: record.reasons as string[] },
    diagnostics
  };
}

export class RoutingManager {
  private baseDir: string;
  private loadResult: RoutingLoadResult;
  private activeRoute?: ActiveRouting;
  private errors: string[];
  private warnings: string[];

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.loadResult = loadRoutingConfig(this.baseDir);
    this.errors = this.loadResult.status === 'invalid' ? this.loadResult.errors : [];
    this.warnings = this.loadResult.status === 'configured'
      ? ['routing.json has not been activated by the OpenCode config hook']
      : [];
  }

  activate(cfg: any): RoutingStatus {
    this.activeRoute = undefined;
    if (this.loadResult.status !== 'configured') {
      return this.status();
    }

    if (!cfg || typeof cfg !== 'object') {
      this.errors = ['routing.json: OpenCode config is not mutable'];
      this.warnings = [];
      return this.status();
    }

    const existingAgents = cfg.agent && typeof cfg.agent === 'object' ? cfg.agent : {};
    const additions: Record<string, any> = {};
    const resolvedBindings: Record<string, RouteCandidate> = {};
    const generatedAgents: string[] = [];
    const errors: string[] = [];

    for (const [name, target] of Object.entries(this.loadResult.config.bindings)) {
      if ('model' in target) {
        const agentName = `${ROUTE_AGENT_PREFIX}${name}`;
        const definition = generatedAgentDefinition(target);
        const existing = existingAgents[agentName];
        if (existing && stableStringify(managedGeneratedAgentDefinition(existing)) !==
            stableStringify(managedGeneratedAgentDefinition(definition))) {
          errors.push(`bindings.${name}: generated agent "${agentName}" conflicts with an existing definition`);
          continue;
        }
        if (!existing) additions[agentName] = definition;
        generatedAgents.push(agentName);
        resolvedBindings[name] = {
          binding: name,
          agent: agentName,
          model: target.model,
          ...(target.variant ? { variant: target.variant } : {}),
          attemptIndex: 0
        };
        continue;
      }

      if (target.agent.startsWith(ROUTE_AGENT_PREFIX)) {
        errors.push(`bindings.${name}.agent: reserved prefix "${ROUTE_AGENT_PREFIX}" is not allowed`);
        continue;
      }
      const existing = existingAgents[target.agent];
      if (!existing) {
        errors.push(`bindings.${name}.agent: agent "${target.agent}" does not exist`);
        continue;
      }
      if (existing.disable === true) {
        errors.push(`bindings.${name}.agent: agent "${target.agent}" is disabled`);
        continue;
      }
      if (existing.mode === 'primary') {
        errors.push(`bindings.${name}.agent: agent "${target.agent}" is not callable as a subagent`);
        continue;
      }
      if (typeof existing.model !== 'string' || existing.model.trim() === '') {
        errors.push(`bindings.${name}.agent: agent "${target.agent}" does not have a static model`);
        continue;
      }
      resolvedBindings[name] = {
        binding: name,
        agent: target.agent,
        model: existing.model,
        ...(typeof existing.variant === 'string' && existing.variant ? { variant: existing.variant } : {}),
        attemptIndex: 0
      };
    }

    if (errors.length > 0) {
      this.errors = errors;
      this.warnings = [];
      return this.status();
    }

    try {
      if (Object.keys(additions).length > 0) {
        cfg.agent = { ...existingAgents, ...additions };
      }
      this.activeRoute = {
        configHash: this.loadResult.configHash,
        config: this.loadResult.config,
        bindings: resolvedBindings,
        generatedAgents
      };
      this.errors = [];
      this.warnings = [];
      return this.status();
    } catch (error) {
      this.errors = [`routing.json: activation failed: ${error instanceof Error ? error.message : String(error)}`];
      this.warnings = [];
      throw error;
    }
  }

  resolve(classification: unknown, override?: RouteOverride, attemptIndex = 0): RouteResolution {
    const activeRoute = this.activeRoute;
    if (!activeRoute) {
      const routing = this.status();
      return this.snapshot({
        status: 'fallback',
        fallback: 'default-host',
        decision: null,
        diagnostics: [
          'No valid routing agent is available; use the host default Task behavior',
          ...routing.errors,
          ...routing.warnings
        ],
        routing
      });
    }

    const parsed = parseClassification(classification, activeRoute.config.defaultLevel);
    let effectiveLevel = parsed.classification.level;
    let bindingOrder = activeRoute.config.levels[effectiveLevel];
    let appliedOverride: RouteDecision['override'];

    if (override) {
      if (override.source !== 'tui') throw new Error('Route override source must be "tui"');
      if (override.binding === undefined && override.level === undefined) {
        throw new Error('Route override must specify level or binding');
      }
      if (override.binding !== undefined) {
        const allowedBindings = activeRoute.config.overrides?.allowedBindings ?? [];
        if (!allowedBindings.includes(override.binding)) {
          throw new Error(`Binding override "${override.binding}" is not allowed`);
        }
        bindingOrder = [override.binding];
        appliedOverride = { type: 'binding', value: override.binding, source: 'tui' };
      } else if (override.level !== undefined) {
        const allowedLevels = activeRoute.config.overrides === undefined
          ? COMPLEXITY_LEVELS
          : activeRoute.config.overrides.allowedLevels ?? [];
        if (!COMPLEXITY_LEVELS.includes(override.level as ComplexityLevel) ||
            !allowedLevels.includes(override.level as ComplexityLevel)) {
          throw new Error(`Level override "${override.level}" is not allowed`);
        }
        effectiveLevel = override.level as ComplexityLevel;
        bindingOrder = activeRoute.config.levels[effectiveLevel];
        appliedOverride = { type: 'level', value: effectiveLevel, source: 'tui' };
      }
    }

    const candidates = bindingOrder.map((binding, candidateIndex) => ({
      ...activeRoute.bindings[binding],
      attemptIndex: candidateIndex
    }));
    if (!Number.isInteger(attemptIndex) || attemptIndex < 0 || attemptIndex >= candidates.length) {
      throw new Error(`Route attemptIndex ${attemptIndex} is out of range`);
    }
    const selected = candidates[attemptIndex];

    return this.snapshot({
      status: 'resolved',
      decision: {
        classifiedLevel: parsed.classification.level,
        reasons: parsed.classification.reasons,
        effectiveLevel,
        bindingOrder: [...bindingOrder],
        selectedBinding: selected.binding,
        agent: selected.agent,
        attemptIndex,
        configHash: activeRoute.configHash,
        ...(appliedOverride ? { override: appliedOverride } : {})
      },
      candidates,
      nextAttempt: candidates[attemptIndex + 1] || null,
      diagnostics: parsed.diagnostics
    });
  }

  status(): RoutingStatus {
    const parsed = this.loadResult.status === 'configured' ? this.loadResult : undefined;
    return this.snapshot({
      path: this.loadResult.path,
      configured: this.loadResult.status !== 'disabled',
      active: this.activeRoute !== undefined,
      errors: this.errors,
      warnings: this.warnings,
      ...(parsed ? {
        configHash: parsed.configHash,
        defaultLevel: parsed.config.defaultLevel,
        levels: parsed.config.levels
      } : {}),
      generatedAgents: this.activeRoute?.generatedAgents ?? []
    });
  }

  private snapshot<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}
