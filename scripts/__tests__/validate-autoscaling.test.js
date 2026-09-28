/**
 * Tests for scripts/validate-autoscaling.js (issue #1289).
 *
 * Exercised through the root Jest project (`npm run test`).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tool = require('../validate-autoscaling');

const {
  MANIFEST_FILES,
  USAGE,
  loadDocuments,
  parseArgs,
  parseScalar,
  parseYaml,
  run,
  validateAutoscaling,
} = tool;

const VALID_MANIFESTS = {
  'api-deployment.yaml': `---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: subtrackr-api
  namespace: subtrackr
  labels:
    app: subtrackr-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: subtrackr-api
  template:
    metadata:
      labels:
        app: subtrackr-api
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: api
          image: subtrackr/api:latest
          ports:
            - containerPort: 3000
              name: http
          resources:
            requests:
              cpu: '500m'
              memory: '512Mi'
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3000
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
          lifecycle:
            preStop:
              exec:
                command: ['sh', '-c', 'sleep 10']
---
apiVersion: v1
kind: Service
metadata:
  name: subtrackr-api
  namespace: subtrackr
spec:
  selector:
    app: subtrackr-api
  ports:
    - port: 80
      targetPort: 3000
`,
  'api-autoscaling.yaml': `---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: subtrackr-api
  namespace: subtrackr
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: subtrackr-api
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
        - type: Percent
          value: 100
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 25
          periodSeconds: 60
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: subtrackr-api
  namespace: subtrackr
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: subtrackr-api
`,
};

let dir;
let logSpy;
let errorSpy;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-autoscaling-'));
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeManifests(overrides = {}) {
  for (const file of MANIFEST_FILES) {
    fs.writeFileSync(path.join(dir, file), overrides[file] ?? VALID_MANIFESTS[file], 'utf8');
  }
}

const documents = (overrides) => {
  writeManifests(overrides);
  return loadDocuments(dir);
};

const mutateYAML = (transform) => {
  for (const file of MANIFEST_FILES) {
    const next = transform(VALID_MANIFESTS[file], file);
    if (typeof next === 'string' && next !== VALID_MANIFESTS[file]) {
      return documents({ [file]: next });
    }
  }
  throw new Error('transform() did not change any manifest');
};

/** Removes a key and every line nested under it. */
const dropBlock = (yaml, key) => {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^(\\s*)${key}:$`).test(line));
  if (start === -1) return yaml;
  const indent = lines[start].search(/\S/);
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || lines[end].search(/\S/) > indent)) {
    end += 1;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
};

describe('validate-autoscaling :: YAML subset parser', () => {
  it('parses nested maps, sequences of maps and scalars', () => {
    const doc = parseYaml(
      [
        'a: 1',
        'b:',
        '  c: two',
        '  d:',
        '    - x: 1',
        '      y: 2',
        '    - plain',
        'e: []',
        'f: {k: v}',
      ].join('\n')
    )[0];
    expect(doc).toEqual({
      a: 1,
      b: { c: 'two', d: [{ x: 1, y: 2 }, 'plain'] },
      e: [],
      f: { k: 'v' },
    });
  });

  it('splits multiple documents and ignores comments', () => {
    const docs = parseYaml('---\n# leading\nkind: A\n---\nkind: B  # trailing\n');
    expect(docs).toHaveLength(2);
    expect(docs[0].kind).toBe('A');
    expect(docs[1].kind).toBe('B');
  });

  it('does not treat a hash inside a quoted string as a comment', () => {
    expect(parseYaml("a: 'x # y'\n")[0].a).toBe('x # y');
  });

  it('preserves colons inside values', () => {
    const doc = parseYaml('a: /healthz\nb: subtrackr/api:latest\nc: postgresql://h:5432/d\n')[0];
    expect(doc.a).toBe('/healthz');
    expect(doc.b).toBe('subtrackr/api:latest');
    expect(doc.c).toBe('postgresql://h:5432/d');
  });

  it('coerces scalar types', () => {
    expect(parseScalar('true')).toBe(true);
    expect(parseScalar('null')).toBe(null);
    expect(parseScalar('~')).toBe(null);
    expect(parseScalar('7')).toBe(7);
    expect(parseScalar('1.5')).toBe(1.5);
    expect(parseScalar("'7'")).toBe('7');
    expect(parseScalar('512Mi')).toBe('512Mi');
  });
});

describe('validate-autoscaling :: the shipped manifests', () => {
  it('parses the checked-in manifests without error', () => {
    const result = validateAutoscaling(loadDocuments(path.join('infra', 'kubernetes')));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.hpa.metadata.name).toBe('subtrackr-api');
    expect(result.deployment.metadata.name).toBe('subtrackr-api');
  });

  it('reports the replica range it validated', () => {
    const result = validateAutoscaling(loadDocuments(path.join('infra', 'kubernetes')));
    expect(result.hpa.spec.minReplicas).toBe(2);
    expect(result.hpa.spec.maxReplicas).toBe(8);
  });
});

const errorsFor = (transform) => validateAutoscaling(mutateYAML(transform)).errors;
const warningsFor = (transform) => validateAutoscaling(mutateYAML(transform)).warnings;

describe('validate-autoscaling :: sizing rules', () => {
  it('rejects a missing minReplicas', () => {
    const errors = errorsFor((yaml) => yaml.replace('  minReplicas: 2\n', ''));
    expect(errors.join(' ')).toContain('minReplicas must be a positive integer');
  });

  it('rejects maxReplicas below minReplicas', () => {
    const errors = errorsFor((yaml) => yaml.replace('maxReplicas: 8', 'maxReplicas: 2'));
    expect(errors.join(' ')).toContain('must be greater than minReplicas');
  });

  it('rejects a maxReplicas with no burst headroom', () => {
    const errors = errorsFor((yaml) =>
      yaml.replace('maxReplicas: 8', 'maxReplicas: 2').replace('minReplicas: 2', 'minReplicas: 1')
    );
    expect(errors.join(' ')).toContain('no headroom');
  });
});

describe('validate-autoscaling :: metric rules', () => {
  it('rejects a Resource metric with no matching request', () => {
    const errors = errorsFor((yaml) => yaml.replace(/ +cpu: '500m'\n/, ''));
    expect(errors.join(' ')).toContain('no matching container resources.requests.cpu');
  });

  it('rejects a utilisation target above 100', () => {
    const errors = errorsFor((yaml) =>
      yaml.replace('averageUtilization: 70', 'averageUtilization: 150')
    );
    expect(errors.join(' ')).toContain('averageUtilization must be a percentage');
  });

  it('rejects a non-utilization target', () => {
    const errors = errorsFor((yaml) => yaml.replace('type: Utilization', 'type: AverageValue'));
    expect(errors.join(' ')).toContain('must target Utilization');
  });

  it('rejects an empty metric list', () => {
    const errors = errorsFor((yaml) => yaml.replace(/ +metrics:\n( +.*\n)+/, '  metrics: []\n'));
    expect(errors.join(' ')).toContain('metrics is empty');
  });
});

describe('validate-autoscaling :: wiring rules', () => {
  it('rejects a scale target that is not in the manifest set', () => {
    const errors = errorsFor((yaml) =>
      yaml.replace('name: subtrackr-api\n  minReplicas', 'name: other-api\n  minReplicas')
    );
    expect(errors.join(' ')).toContain('not in the manifest set');
  });

  it('rejects autoscaling/v1', () => {
    const errors = errorsFor((yaml) => yaml.replace('autoscaling/v2', 'autoscaling/v1'));
    expect(errors.join(' ')).toContain('must be autoscaling/v2');
  });

  it('rejects a namespace mismatch between the HPA and its target', () => {
    const errors = errorsFor((yaml) =>
      yaml.replace('  namespace: subtrackr\n', '  namespace: x\n')
    );
    expect(errors.join(' ')).toContain('does not match Deployment namespace');
  });

  it('rejects a missing PodDisruptionBudget', () => {
    const errors = errorsFor((yaml) => yaml.replace(/---\napiVersion: policy\/v1[\s\S]*$/, ''));
    expect(errors.join(' ')).toContain('No PodDisruptionBudget found');
  });

  it('rejects a PDB that selects labels the pods do not carry', () => {
    const pdbSelector = /(spec:\n  maxUnavailable: 1\n  selector:\n    matchLabels:\n      app: )/;
    const errors = errorsFor((yaml) => yaml.replace(pdbSelector, '$1other-label-'));
    expect(errors.join(' ')).toContain('PodDisruptionBudget selects');
  });

  it('rejects a Service that targets an undeclared port', () => {
    const errors = errorsFor((yaml) => yaml.replace('targetPort: 3000', 'targetPort: 8080'));
    expect(errors.join(' ')).toContain('does not match any declared containerPort');
  });

  it('rejects a pod template that does not satisfy its own selector', () => {
    const errors = errorsFor((yaml) => {
      const podLabels = '  template:\n    metadata:\n      labels:\n        app: subtrackr-api';
      return yaml.replace(podLabels, podLabels.replace('app: subtrackr-api', 'app: other'));
    });
    expect(errors.join(' ')).toContain('does not satisfy selector');
  });
});

describe('validate-autoscaling :: behaviour rules', () => {
  it('rejects a missing scaleDown block', () => {
    const errors = errorsFor((yaml) => yaml.replace(/ +scaleDown:\n( +.*\n)+/, ''));
    expect(errors.join(' ')).toContain('behavior.scaleDown is required');
  });

  it('rejects an empty policy list', () => {
    const errors = errorsFor((yaml) => dropBlock(yaml, 'policies'));
    expect(errors.join(' ')).toContain('policies must not be empty');
  });

  it('warns about a flappy scaleDown window', () => {
    const warnings = warningsFor((yaml) =>
      yaml.replace('stabilizationWindowSeconds: 300', 'stabilizationWindowSeconds: 15')
    );
    expect(warnings.join(' ')).toContain('flap');
  });
});

describe('validate-autoscaling :: scale-down safety warnings', () => {
  it('warns when a scaled-down pod could be killed mid-request', () => {
    const warnings = warningsFor((yaml) =>
      yaml.replace('      terminationGracePeriodSeconds: 45\n', '')
    );
    expect(warnings.join(' ')).toContain('terminationGracePeriodSeconds');
  });

  it('warns when there is no preStop hook', () => {
    const warnings = warningsFor((yaml) => dropBlock(yaml, 'lifecycle'));
    expect(warnings.join(' ')).toContain('preStop');
  });

  it('warns when the declared replicas exceed the HPA floor', () => {
    const warnings = warningsFor((yaml) => yaml.replace('  replicas: 2', '  replicas: 5'));
    expect(warnings.join(' ')).toContain('exceeds HPA minReplicas');
  });
});

describe('validate-autoscaling :: CLI', () => {
  it('applies documented defaults', () => {
    const options = parseArgs([]);
    expect(options.dir).toBe(tool.DEFAULT_DIR);
    expect(options.json).toBe(false);
    expect(options.help).toBe(false);
  });

  it('parses --dir and --json', () => {
    const options = parseArgs(['--dir', 'x', '--json']);
    expect(options.dir).toBe('x');
    expect(options.json).toBe(true);
  });

  it('rejects an unknown argument and a missing --dir value', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--dir'])).toThrow(/requires a path/);
  });

  it('returns 0 for --help', () => {
    expect(run(['--help'])).toBe(0);
    expect(USAGE).toContain('node scripts/validate-autoscaling.js');
  });

  it('returns 2 for a usage error', () => {
    expect(run(['--nope'])).toBe(2);
  });

  it('returns 2 when a manifest file is missing', () => {
    fs.mkdirSync(dir, { recursive: true });
    expect(run(['--dir', dir])).toBe(2);
  });

  it('returns 0 for the checked-in manifests', () => {
    expect(run([])).toBe(0);
  });

  it('returns 1 when a manifest is invalid', () => {
    writeManifests({
      'api-autoscaling.yaml': VALID_MANIFESTS['api-autoscaling.yaml'].replace(
        'maxReplicas: 8',
        'maxReplicas: 1'
      ),
    });
    expect(run(['--dir', dir])).toBe(1);
  });

  it('emits machine-readable JSON', () => {
    const code = run(['--json']);
    expect(code).toBe(0);
    const payload = JSON.parse(logSpy.mock.calls.map((call) => call[0]).join(''));
    expect(payload.valid).toBe(true);
    expect(payload.hpa).toBe('subtrackr-api');
    expect(payload.minReplicas).toBe(2);
    expect(payload.maxReplicas).toBe(8);
  });
});
