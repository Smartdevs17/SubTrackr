import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

type BaselineMap = Record<string, string>;

const baselineFile = path.resolve(__dirname, '../fixtures/visual-baselines.json');
const diffDir = path.resolve(__dirname, '../../artifacts/visual-diffs');

const readBaselines = (): BaselineMap => {
  if (!fs.existsSync(baselineFile)) return {};
  return JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as BaselineMap;
};

const writeBaselines = (baselines: BaselineMap) => {
  fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
  fs.writeFileSync(baselineFile, JSON.stringify(baselines, null, 2));
};

const hashFile = (filePath: string) => {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
};

export const assertVisualSnapshot = (name: string, screenshotPath: string) => {
  const baselines = readBaselines();
  const currentHash = hashFile(screenshotPath);
  const updateBaselines = process.env.UPDATE_VISUAL_BASELINE === 'true';

  if (!baselines[name] || updateBaselines) {
    baselines[name] = currentHash;
    writeBaselines(baselines);
    return;
  }

  if (currentHash !== baselines[name]) {
    fs.mkdirSync(diffDir, { recursive: true });
    fs.writeFileSync(
      path.join(diffDir, `${name}.json`),
      JSON.stringify(
        {
          name,
          baselineHash: baselines[name],
          currentHash,
          screenshotPath,
          capturedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  expect(currentHash).toBe(baselines[name]);
};
