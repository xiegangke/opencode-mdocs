import * as fs from 'fs';
import * as path from 'path';
import {
  RoutingManager,
  type RouteResolution,
  type RoutingConfig
} from '../routing';

const testDir = path.join(__dirname, 'test-routing');

function validConfig(): RoutingConfig {
  return {
    schemaVersion: 1,
    defaultLevel: 'standard',
    levels: {
      simple: ['small', 'shared'],
      standard: ['shared', 'medium'],
      complex: ['large', 'custom']
    },
    bindings: {
      small: { model: 'provider/small', variant: 'fast' },
      shared: { model: 'provider/shared' },
      medium: { model: 'provider/medium' },
      large: { model: 'provider/large', variant: 'reasoning' },
      custom: { agent: 'project-runner' }
    },
    overrides: {
      allowedLevels: ['simple', 'complex'],
      allowedBindings: ['medium', 'large']
    }
  };
}

function writeConfig(config: unknown): void {
  const mdocsDir = path.join(testDir, 'mdocs');
  fs.mkdirSync(mdocsDir, { recursive: true });
  fs.writeFileSync(path.join(mdocsDir, 'routing.json'), JSON.stringify(config), 'utf8');
}

function activatedState(config: RoutingConfig = validConfig()) {
  writeConfig(config);
  const routing = new RoutingManager(testDir);
  const cfg: any = {
    agent: {
      'project-runner': { mode: 'subagent', model: 'provider/custom' }
    }
  };
  const state = routing.activate(cfg);
  return { cfg, routing, state };
}

function expectResolved(result: RouteResolution): asserts result is Extract<RouteResolution, { status: 'resolved' }> {
  expect(result.status).toBe('resolved');
  if (result.status !== 'resolved') throw new Error('Routing should resolve to a static agent');
}

beforeEach(() => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
});

describe('routing config parser', () => {
  test('treats a missing file as disabled', () => {
    const result = new RoutingManager(testDir).status();

    expect(result).toMatchObject({ configured: false, active: false, errors: [], warnings: [] });
  });

  test('reports invalid JSON', () => {
    const mdocsDir = path.join(testDir, 'mdocs');
    fs.mkdirSync(mdocsDir, { recursive: true });
    fs.writeFileSync(path.join(mdocsDir, 'routing.json'), '{', 'utf8');

    const result = new RoutingManager(testDir).status();

    expect(result).toMatchObject({ configured: true, active: false });
    expect(result.errors[0]).toContain('invalid JSON');
  });

  test('accepts uppercase letters in binding names', () => {
    const config = validConfig();
    config.levels.simple = ['MiniMax-M3'];
    config.bindings['MiniMax-M3'] = { model: 'provider/model' };
    writeConfig(config);

    const result = new RoutingManager(testDir).status();

    expect(result).toMatchObject({ configured: true, active: false });
    expect(result.errors).toEqual([]);
  });

  test.each([
    ['unknown top-level field', { ...validConfig(), confidence: 0.9 }, 'Unrecognized key'],
    ['missing level', { ...validConfig(), levels: { simple: ['small'], standard: ['medium'] } }, 'levels.complex'],
    ['empty level', { ...validConfig(), levels: { ...validConfig().levels, simple: [] } }, 'levels.simple'],
    ['duplicate level binding', { ...validConfig(), levels: { ...validConfig().levels, simple: ['small', 'small'] } }, 'duplicate'],
    ['unknown level binding', { ...validConfig(), levels: { ...validConfig().levels, simple: ['missing'] } }, 'unknown binding'],
    ['invalid binding name', { ...validConfig(), bindings: { ...validConfig().bindings, Bad_Name: { model: 'provider/model' } } }, 'bindings'],
    ['model and agent target', { ...validConfig(), bindings: { ...validConfig().bindings, small: { model: 'provider/model', agent: 'runner' } } }, 'Invalid input'],
    ['variant without model', { ...validConfig(), bindings: { ...validConfig().bindings, custom: { agent: 'project-runner', variant: 'fast' } } }, 'Invalid input'],
    ['fallback field', { ...validConfig(), bindings: { ...validConfig().bindings, small: { model: 'provider/model', fallback: 'shared' } } }, 'Invalid input'],
    ['unknown override binding', { ...validConfig(), overrides: { allowedBindings: ['missing'] } }, 'unknown binding']
  ])('rejects %s', (_name, config, message) => {
    writeConfig(config);

    const result = new RoutingManager(testDir).status();

    expect(result).toMatchObject({ configured: true, active: false });
    expect(result.errors.join('\n')).toContain(message);
  });

  test('produces the same hash regardless of object key order', () => {
    writeConfig(validConfig());
    const first = new RoutingManager(testDir).status();
    const config = validConfig();
    writeConfig({
      bindings: config.bindings,
      levels: config.levels,
      overrides: config.overrides,
      defaultLevel: config.defaultLevel,
      schemaVersion: config.schemaVersion
    });
    const second = new RoutingManager(testDir).status();

    expect(first).toMatchObject({ configured: true, active: false });
    expect(second).toMatchObject({ configured: true, active: false });
    expect(first.configHash).toBe(second.configHash);
  });
});

describe('routing config activation', () => {
  test('registers model targets and resolves existing static subagents', () => {
    const { cfg, routing, state } = activatedState();

    expect(state.active).toBe(true);
    expect(cfg.agent['mdocs-route-small']).toMatchObject({
      mode: 'subagent',
      model: 'provider/small',
      variant: 'fast'
    });
    expect(cfg.agent['mdocs-route-small'].permission).toBeUndefined();
    const resolution = routing.resolve({ level: 'complex', reasons: [] });
    expectResolved(resolution);
    expect(resolution.candidates[1])
      .toMatchObject({ agent: 'project-runner', model: 'provider/custom' });
  });

  test('returns defensive activation and status snapshots', () => {
    const { routing, state } = activatedState();
    const activationSnapshot = state as any;
    activationSnapshot.levels.standard[0] = 'large';
    activationSnapshot.generatedAgents.length = 0;

    const statusSnapshot = routing.status();
    expect(statusSnapshot).toMatchObject({
      active: true,
      levels: { standard: ['shared', 'medium'] }
    });
    if (!statusSnapshot.levels) throw new Error('Routing should expose configured levels');
    (statusSnapshot.levels.standard as string[])[0] = 'small';
    (statusSnapshot.generatedAgents as string[]).length = 0;
    const resolutionSnapshot = routing.resolve({ level: 'standard', reasons: ['expected route'] }) as any;
    resolutionSnapshot.decision.reasons[0] = 'changed';
    resolutionSnapshot.decision.bindingOrder[0] = 'large';
    resolutionSnapshot.candidates[0].binding = 'large';

    const nextResolution = routing.resolve({ level: 'standard', reasons: ['expected route'] });
    expectResolved(nextResolution);
    expect(nextResolution.decision).toMatchObject({
      reasons: ['expected route'],
      bindingOrder: ['shared', 'medium'],
      selectedBinding: 'shared'
    });
    expect(nextResolution.candidates[0].binding).toBe('shared');
    expect(routing.status()).toMatchObject({
      active: true,
      levels: { standard: ['shared', 'medium'] },
      generatedAgents: expect.arrayContaining(['mdocs-route-small'])
    });
  });

  test('is idempotent for an identical generated agent', () => {
    writeConfig(validConfig());
    const routing = new RoutingManager(testDir);
    const cfg: any = { agent: { 'project-runner': { mode: 'subagent', model: 'provider/custom' } } };
    const first = routing.activate(cfg);
    const definition = cfg.agent['mdocs-route-small'];
    const second = routing.activate(cfg);

    expect(first.active).toBe(true);
    expect(second.active).toBe(true);
    expect(cfg.agent['mdocs-route-small']).toBe(definition);
  });

  test('ignores unrelated host fields when comparing a generated agent', () => {
    writeConfig(validConfig());
    const routing = new RoutingManager(testDir);
    const cfg: any = { agent: { 'project-runner': { mode: 'subagent', model: 'provider/custom' } } };
    expect(routing.activate(cfg).active).toBe(true);
    cfg.agent['mdocs-route-small'].hostMetadata = { registeredBy: 'opencode' };

    expect(routing.activate(cfg).active).toBe(true);
  });

  test('rejects disable differences in a generated agent', () => {
    writeConfig(validConfig());
    const routing = new RoutingManager(testDir);
    const cfg: any = { agent: { 'project-runner': { mode: 'subagent', model: 'provider/custom' } } };
    expect(routing.activate(cfg).active).toBe(true);
    cfg.agent['mdocs-route-small'].disable = true;

    expect(routing.activate(cfg).active).toBe(false);
  });

  test('replaces the agent map atomically while preserving existing agents', () => {
    writeConfig(validConfig());
    const originalAgents = {
      'mdocs-orchestrator': { mode: 'primary', prompt: 'existing' },
      'project-runner': { mode: 'subagent', model: 'provider/custom' }
    };
    const cfg: any = { agent: originalAgents };

    const state = new RoutingManager(testDir).activate(cfg);

    expect(state.active).toBe(true);
    expect(cfg.agent).not.toBe(originalAgents);
    expect(cfg.agent['mdocs-orchestrator']).toBe(originalAgents['mdocs-orchestrator']);
    expect(originalAgents['mdocs-route-small' as keyof typeof originalAgents]).toBeUndefined();
  });

  test('reports assignment failure instead of claiming a valid activation', () => {
    writeConfig(validConfig());
    const existingAgents = { 'project-runner': { mode: 'subagent', model: 'provider/custom' } };
    const cfg: any = {};
    Object.defineProperty(cfg, 'agent', {
      configurable: true,
      get: () => existingAgents,
      set: () => { throw new Error('read only'); }
    });

    const routing = new RoutingManager(testDir);
    expect(() => routing.activate(cfg)).toThrow('read only');
    expect(routing.status()).toMatchObject({ configured: true, active: false });
    expect(Object.keys(existingAgents).some(name => name.startsWith('mdocs-route-'))).toBe(false);
  });

  test('rejects a conflicting generated agent without registering any route agents', () => {
    writeConfig(validConfig());
    const cfg: any = {
      agent: {
        'project-runner': { mode: 'subagent', model: 'provider/custom' },
        'mdocs-route-small': { mode: 'subagent', model: 'provider/other' }
      }
    };

    const state = new RoutingManager(testDir).activate(cfg);

    expect(state.active).toBe(false);
    expect(cfg.agent['mdocs-route-shared']).toBeUndefined();
    expect(cfg.agent['mdocs-route-small'].model).toBe('provider/other');
  });

  test.each([
    ['missing', undefined],
    ['primary', { mode: 'primary', model: 'provider/custom' }],
    ['disabled', { mode: 'subagent', model: 'provider/custom', disable: true }],
    ['dynamic model', { mode: 'subagent' }]
  ])('atomically rejects %s agent targets', (_name, agent) => {
    writeConfig(validConfig());
    const cfg: any = { agent: agent ? { 'project-runner': agent } : {} };

    const state = new RoutingManager(testDir).activate(cfg);

    expect(state.active).toBe(false);
    expect(Object.keys(cfg.agent).some(name => name.startsWith('mdocs-route-'))).toBe(false);
  });

  test('accepts an agent target with omitted mode', () => {
    writeConfig(validConfig());
    const cfg: any = { agent: { 'project-runner': { model: 'provider/custom' } } };

    const omittedModeState = new RoutingManager(testDir).activate(cfg);

    expect(omittedModeState.active).toBe(true);
  });

  test('rejects an agent target using the reserved prefix', () => {
    const config = validConfig();
    config.bindings.custom = { agent: 'mdocs-route-user' };
    writeConfig(config);
    const state = new RoutingManager(testDir).activate({ agent: {} });

    expect(state.active).toBe(false);
  });
});

describe('deterministic route resolver', () => {
  test.each([
    ['not configured', undefined, false],
    ['not activated', validConfig(), true],
    ['invalid', { ...validConfig(), levels: { ...validConfig().levels, simple: [] } }, true]
  ])('returns default-host fallback when routing is %s', (_status, config, configured) => {
    if (config) writeConfig(config);
    const result = new RoutingManager(testDir).resolve({ level: 'standard', reasons: [] });

    expect(result).toMatchObject({
      status: 'fallback',
      fallback: 'default-host',
      decision: null,
      routing: { configured, active: false }
    });
    expect((result as any).agent).toBeUndefined();
  });

  test('preserves level order and selects attempt zero', () => {
    const { routing } = activatedState();
    const result = routing.resolve({ level: 'standard', reasons: ['multiple related files'] });
    expectResolved(result);

    expect(result.decision).toMatchObject({
      classifiedLevel: 'standard',
      effectiveLevel: 'standard',
      bindingOrder: ['shared', 'medium'],
      selectedBinding: 'shared',
      agent: 'mdocs-route-shared',
      attemptIndex: 0
    });
    expect(result.candidates.map(candidate => [candidate.binding, candidate.attemptIndex])).toEqual([
      ['shared', 0],
      ['medium', 1]
    ]);
    expect(result.nextAttempt?.binding).toBe('medium');
  });

  test('uses defaultLevel only for an invalid classification', () => {
    const { routing } = activatedState();
    const result = routing.resolve({ level: 'unknown', reasons: [] });
    expectResolved(result);

    expect(result.decision.classifiedLevel).toBe('standard');
    expect(result.decision.bindingOrder).toEqual(['shared', 'medium']);
    expect(result.diagnostics).toContain('Classification is missing or invalid; defaultLevel was used');
  });

  test('ignores and diagnoses classifier routing fields', () => {
    const { routing } = activatedState();
    const result = routing.resolve({
      level: 'simple',
      reasons: ['localized'],
      confidence: 0.9,
      binding: 'large'
    });
    expectResolved(result);

    expect(result.decision.selectedBinding).toBe('small');
    expect(result.diagnostics.join('\n')).toContain('confidence, binding');
  });

  test('applies allowed level overrides without changing classifiedLevel', () => {
    const { routing } = activatedState();
    const result = routing.resolve(
      { level: 'standard', reasons: ['normal work'] },
      { source: 'tui', level: 'complex' }
    );
    expectResolved(result);

    expect(result.decision.classifiedLevel).toBe('standard');
    expect(result.decision.effectiveLevel).toBe('complex');
    expect(result.decision.bindingOrder).toEqual(['large', 'custom']);
    expect(result.decision.override).toEqual({ type: 'level', value: 'complex', source: 'tui' });
  });

  test('gives binding override precedence and returns no same-level backup', () => {
    const { routing } = activatedState();
    const result = routing.resolve(
      { level: 'simple', reasons: ['localized'] },
      { source: 'tui', level: 'complex', binding: 'medium' }
    );
    expectResolved(result);

    expect(result.decision.bindingOrder).toEqual(['medium']);
    expect(result.decision.override).toEqual({ type: 'binding', value: 'medium', source: 'tui' });
    expect(result.candidates).toHaveLength(1);
    expect(result.nextAttempt).toBeNull();
  });

  test.each(['simple', 'standard', 'complex'] as const)(
    'allows the %s level override by default when overrides is omitted',
    overrideLevel => {
      const config = validConfig();
      delete config.overrides;
      const { routing } = activatedState(config);

      const result = routing.resolve({ level: 'standard', reasons: [] }, {
        source: 'tui',
        level: overrideLevel
      });
      expectResolved(result);
      expect(result.decision.effectiveLevel).toBe(overrideLevel);
    }
  );

  test('forbids binding overrides by default when overrides is omitted', () => {
    const config = validConfig();
    delete config.overrides;
    const { routing } = activatedState(config);

    expect(() => routing.resolve({ level: 'simple', reasons: [] }, {
      source: 'tui',
      binding: 'small'
    })).toThrow('Binding override');
  });

  test('treats omitted allowlists in an explicit overrides object as forbidden', () => {
    const config = validConfig();
    config.overrides = {};
    const { routing } = activatedState(config);

    expect(() => routing.resolve({ level: 'simple', reasons: [] }, {
      source: 'tui',
      level: 'complex'
    })).toThrow('Level override');
    expect(() => routing.resolve({ level: 'simple', reasons: [] }, {
      source: 'tui',
      binding: 'small'
    })).toThrow('Binding override');
  });

  test('selects later candidates by attempt index and advances nextAttempt', () => {
    const config = validConfig();
    config.levels.standard = ['small', 'shared', 'medium'];
    const { routing } = activatedState(config);

    const second = routing.resolve({ level: 'standard', reasons: [] }, undefined, 1);
    const third = routing.resolve({ level: 'standard', reasons: [] }, undefined, 2);
    expectResolved(second);
    expectResolved(third);

    expect(second.decision).toMatchObject({ selectedBinding: 'shared', agent: 'mdocs-route-shared', attemptIndex: 1 });
    expect(second.nextAttempt).toMatchObject({ binding: 'medium', attemptIndex: 2 });
    expect(third.decision).toMatchObject({ selectedBinding: 'medium', agent: 'mdocs-route-medium', attemptIndex: 2 });
    expect(third.nextAttempt).toBeNull();
  });

  test('rejects an attempt index outside the candidate list', () => {
    const config = validConfig();
    config.levels.standard = ['small', 'shared', 'medium'];
    const { routing } = activatedState(config);

    expect(() => routing.resolve({ level: 'standard', reasons: [] }, undefined, 3)).toThrow('out of range');
  });

  test.each([
    [{ source: 'tui', level: 'standard' }, 'Level override'],
    [{ source: 'tui', binding: 'small' }, 'Binding override'],
    [{ source: 'tui' }, 'must specify'],
    [{ source: 'memory', level: 'complex' }, 'source']
  ])('rejects non-allowlisted or non-TUI overrides', (override, message) => {
    const { routing } = activatedState();

    expect(() => routing.resolve({ level: 'simple', reasons: [] }, override as any)).toThrow(message);
  });
});
