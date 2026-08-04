import * as fs from 'fs';
import * as path from 'path';
import { createPlugin } from '../plugin';
import { RoutingManager } from '../routing';

const testDir = path.join(__dirname, 'test-routing-plugin');

const routingConfig = {
  schemaVersion: 1,
  defaultLevel: 'standard',
  levels: {
    simple: ['small'],
    standard: ['medium', 'backup'],
    complex: ['large']
  },
  bindings: {
    small: { model: 'provider/small' },
    medium: { model: 'provider/medium' },
    backup: { agent: 'project-backup' },
    large: { model: 'provider/large', variant: 'reasoning' }
  },
  overrides: {
    allowedLevels: ['complex'],
    allowedBindings: ['backup']
  }
};

function writeRouting(value: unknown): void {
  const mdocsDir = path.join(testDir, 'mdocs');
  fs.mkdirSync(mdocsDir, { recursive: true });
  fs.writeFileSync(path.join(mdocsDir, 'routing.json'), JSON.stringify(value), 'utf8');
}

beforeEach(() => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
});

describe('routing plugin integration', () => {
  test('keeps existing behavior when routing is not configured', async () => {
    const plugin = createPlugin(testDir) as any;
    const cfg: any = {};
    plugin.config(cfg);

    const status = await plugin.tool.mdocs_status.execute();
    const route = await plugin.tool.mdocs_route.execute({ classification: { level: 'simple', reasons: [] } });
    const dispatch = await plugin.tool.mdocs_dispatch.execute();

    expect(status.routing).toMatchObject({ configured: false, active: false, errors: [], warnings: [] });
    expect(status.validation.routing).toEqual(status.routing);
    expect(dispatch.routing).toBeUndefined();
    expect(route).toMatchObject({
      status: 'fallback',
      fallback: 'default-host',
      decision: null,
      routing: { configured: false, active: false }
    });
    expect(Object.keys(cfg.agent).some(name => name.startsWith('mdocs-route-'))).toBe(false);
  });

  test('registers routes and exposes decisions through tools', async () => {
    writeRouting(routingConfig);
    const plugin = createPlugin(testDir) as any;
    const cfg: any = {
      agent: {
        'project-backup': { mode: 'subagent', model: 'provider/backup' }
      }
    };
    plugin.config(cfg);

    const route = await plugin.tool.mdocs_route.execute({
      classification: { level: 'standard', reasons: ['multiple steps'] }
    });
    const status = await plugin.tool.mdocs_status.execute();
    const validation = await plugin.tool.mdocs_validate.execute();

    expect(cfg.agent['mdocs-route-medium']).toMatchObject({ mode: 'subagent', model: 'provider/medium' });
    expect(cfg.agent['mdocs-orchestrator']).toBeDefined();
    expect(route.decision).toMatchObject({
      classifiedLevel: 'standard',
      bindingOrder: ['medium', 'backup'],
      selectedBinding: 'medium',
      attemptIndex: 0
    });
    expect(route.nextAttempt).toMatchObject({ binding: 'backup', agent: 'project-backup', attemptIndex: 1 });
    expect(status.routing).toMatchObject({ configured: true, active: true, defaultLevel: 'standard' });
    expect(validation.routing.active).toBe(true);
    expect(validation.valid).toBe(true);
  });

  test('does not expose override or attemptIndex through the model-callable route tool', () => {
    const plugin = createPlugin(testDir) as any;

    expect(Object.keys(plugin.tool.mdocs_route.args)).toEqual(['classification']);
  });

  test('passes invalid classification values to the resolver defaultLevel parser', async () => {
    writeRouting(routingConfig);
    const plugin = createPlugin(testDir) as any;
    plugin.config({ agent: { 'project-backup': { mode: 'subagent', model: 'provider/backup' } } });

    expect(plugin.tool.mdocs_route.args.classification.safeParse({ level: 'invalid' }).success).toBe(true);
    const route = await plugin.tool.mdocs_route.execute({ classification: { level: 'invalid' } });

    expect(route.decision).toMatchObject({ classifiedLevel: 'standard', selectedBinding: 'medium' });
    expect(route.diagnostics.join('\n')).toContain('defaultLevel was used');
  });

  test('ignores a forged override passed directly to the route tool executor', async () => {
    writeRouting(routingConfig);
    const routing = new RoutingManager(testDir);
    routing.activate({ agent: { 'project-backup': { model: 'provider/backup' } } });
    const plugin = createPlugin(testDir) as any;
    plugin.config({ agent: { 'project-backup': { model: 'provider/backup' } } });

    const directRoute = routing.resolve(
      { level: 'simple', reasons: [] },
      { source: 'tui', binding: 'backup' }
    );

    const route = await plugin.tool.mdocs_route.execute({
      classification: { level: 'simple', reasons: [] },
      override: { source: 'tui', binding: 'backup' }
    });

    expect(directRoute.status).toBe('resolved');
    if (directRoute.status !== 'resolved') throw new Error('Routing should resolve to a static agent');
    expect(directRoute.decision.selectedBinding).toBe('backup');
    expect(route.decision.selectedBinding).toBe('small');
    expect(route.decision.override).toBeUndefined();
  });

  test('treats configured routing as pending validation before the config hook runs', async () => {
    writeRouting(routingConfig);
    const plugin = createPlugin(testDir) as any;
    await plugin.tool.mdocs_init.execute();

    const validation = await plugin.tool.mdocs_validate.execute();

    expect(validation.routing).toMatchObject({ configured: true, active: false });
    expect(validation.routing.warnings.join('\n')).toContain('has not been activated');
    expect(validation.valid).toBe(true);
  });

  test('keeps routing out of dispatch while preserving context assembly', async () => {
    writeRouting(routingConfig);
    const plugin = createPlugin(testDir) as any;
    plugin.config({ agent: { 'project-backup': { mode: 'subagent', model: 'provider/backup' } } });
    const initiativeDir = path.join(testDir, 'mdocs', 'initiatives');
    fs.writeFileSync(path.join(initiativeDir, 'route-work--2026-08-04.md'), `---
id: "route-work"
title: "Route Work"
status: "active"
created: "2026-08-04"
updated: "2026-08-04"
owner: "test"
tags: []
related_wiki: []
---

## Objective
Route this work.

## Plan
- [ ] Execute

## Progress Log

## Artifacts
`, 'utf8');

    const result = await plugin.tool.mdocs_dispatch.execute({ initiativeId: 'route-work' });

    expect(result.context).toContain('Route this work.');
    expect(result.routing).toBeUndefined();
  });

  test('reports invalid routing through status without extending dispatch', async () => {
    writeRouting({ ...routingConfig, levels: { ...routingConfig.levels, simple: [] } });
    const plugin = createPlugin(testDir) as any;
    plugin.config({});
    const initiativeDir = path.join(testDir, 'mdocs', 'initiatives');
    fs.writeFileSync(path.join(initiativeDir, 'invalid-route--2026-08-04.md'), `---
id: "invalid-route"
title: "Invalid Route"
status: "active"
created: "2026-08-04"
updated: "2026-08-04"
owner: "test"
tags: []
related_wiki: []
---

## Objective
Report invalid routing.

## Plan
- [ ] Execute

## Progress Log

## Artifacts
`, 'utf8');

    const result = await plugin.tool.mdocs_dispatch.execute({ initiativeId: 'invalid-route' });
    const status = await plugin.tool.mdocs_status.execute();

    expect(result.routing).toBeUndefined();
    expect(status.routing).toMatchObject({
      configured: true,
      active: false
    });
    expect(status.routing.errors.join('\n')).toContain('levels.simple');
  });

  test('reports schema errors and registers no route agents', async () => {
    writeRouting({ ...routingConfig, levels: { ...routingConfig.levels, simple: [] } });
    const plugin = createPlugin(testDir) as any;
    const cfg: any = {};
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    plugin.config(cfg);
    const validation = await plugin.tool.mdocs_validate.execute();

    expect(validation.valid).toBe(true);
    expect(validation.routing).toMatchObject({ configured: true, active: false });
    expect(validation.routing.errors.join('\n')).toContain('levels.simple');
    expect(Object.keys(cfg.agent).some(name => name.startsWith('mdocs-route-'))).toBe(false);
    error.mockRestore();
  });

  test('reports target conflicts atomically through status and route tools', async () => {
    writeRouting(routingConfig);
    const plugin = createPlugin(testDir) as any;
    const cfg: any = {
      agent: {
        'project-backup': { mode: 'subagent', model: 'provider/backup' },
        'mdocs-route-medium': { mode: 'subagent', model: 'provider/conflict' }
      }
    };
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    plugin.config(cfg);
    const status = await plugin.tool.mdocs_status.execute();
    const route = await plugin.tool.mdocs_route.execute({ classification: { level: 'standard', reasons: [] } });

    expect(status.routing.active).toBe(false);
    expect(status.routing.errors.join('\n')).toContain('conflicts with an existing definition');
    expect(cfg.agent['mdocs-route-small']).toBeUndefined();
    expect(route).toMatchObject({
      status: 'fallback',
      fallback: 'default-host',
      decision: null,
      routing: { configured: true, active: false }
    });
    error.mockRestore();
  });
});
