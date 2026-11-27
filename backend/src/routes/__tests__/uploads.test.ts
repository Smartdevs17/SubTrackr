/** Route-level tests for upload routes with streaming parser (Issue #2278). */

import { EventEmitter } from 'events';
import { registerUploadRoutes, type UploadRequest, type UploadResponse } from '../uploads';

class FakeRequest extends EventEmitter implements UploadRequest {
  headers: Record<string, string | string[] | undefined> = {};
  method = 'POST';
  url: string;
  destroyed = false;

  constructor(url: string, headers: Record<string, string | string[] | undefined> = {}) {
    super();
    this.url = url;
    this.headers = headers;
  }
}

class FakeResponse implements UploadResponse {
  statusCode = 200;
  body: unknown = null;
  headers: Record<string, string> = {};

  status(code: number): UploadResponse {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): void {
    this.body = body;
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
}

class FakeRouter {
  readonly routes = new Map<string, (req: UploadRequest, res: UploadResponse) => Promise<void>>();

  post(path: string, handler: (req: UploadRequest, res: UploadResponse) => Promise<void>): void {
    this.routes.set(path, handler);
  }
}

function boundaryBody(fields: { name: string; value: string }[], files: { name: string; fileName: string; mime: string; data: Buffer }[]): Buffer {
  const boundary = '----WebKitFormBoundary';
  const chunks: Buffer[] = [];
  for (const f of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${f.name}"\r\n\r\n`));
    chunks.push(Buffer.from(`${f.value}\r\n`));
  }
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${f.name}"; filename="${f.fileName}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${f.mime}\r\n\r\n`));
    chunks.push(f.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

function invoke(router: FakeRouter, path: string, headers: Record<string, string | string[] | undefined>, chunks: Buffer[]): Promise<FakeResponse> {
  const handler = router.routes.get(path);
  if (!handler) throw new Error(`no route for ${path}`);
  const req = new FakeRequest(path, headers);
  const res = new FakeResponse();
  const promise = handler(req, res).then(() => res);
  for (const chunk of chunks) req.emit('data', chunk);
  req.emit('end');
  return promise;
}

describe('registerUploadRoutes', () => {
  it('accepts a small octet-stream upload and returns its size', async () => {
    const router = new FakeRouter();
    let received: any = null;
    registerUploadRoutes(router, { onUpload: (result) => { received = result; } });

    const res = await invoke(router, '/uploads', { 'content-type': 'application/octet-stream' }, [Buffer.from('hello world')]);
    expect(res.statusCode).toBe(200);
    expect((res.body as any).success).toBe(true);
    expect((res.body as any).data.size).toBe(11);
    expect((res.body as any).data.contentType).toBe('application/octet-stream');
    expect(received.size).toBe(11);
  });

  it('rejects a streamed body that exceeds maxBytes with 413', async () => {
    const router = new FakeRouter();
    registerUploadRoutes(router, { maxBytes: 5 });

    const res = await invoke(router, '/uploads', { 'content-type': 'application/octet-stream' }, [Buffer.from('this is way too long')]);
    expect(res.statusCode).toBe(413);
    expect((res.body as any).success).toBe(false);
    expect((res.body as any).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.headers['x-upload-limit-bytes']).toBe(String(5));
  });

  it('parses multipart/form-data into fields and files', async () => {
    const router = new FakeRouter();
    let received: any = null;
    registerUploadRoutes(router, { onUpload: (result) => { received = result; } });

    const body = boundaryBody(
      [{ name: 'title', value: 'My receipt' }],
      [{ name: 'file', fileName: 'receipt.png', mime: 'image/png', data: Buffer.from([137, 80, 78, 71]) }],
    );

    const res = await invoke(router, '/uploads', { 'content-type': `multipart/form-data; boundary=----WebKitFormBoundary` }, [body]);
    expect(res.statusCode).toBe(200);
    const data = (res.body as any).data;
    expect(data.size).toBe(body.length);
    expect(data.fields.find((f: any) => f.fieldName === 'title')?.value).toBe('My receipt');
    expect(data.files.length).toBe(1);
    expect(data.files[0].fieldName).toBe('file');
    expect(data.files[0].originalName).toBe('receipt.png');
    expect(data.files[0].mimeType).toBe('image/png');
    expect(data.files[0].size).toBe(4);
    expect(received.files[0].buffer).toEqual(Buffer.from([137, 80, 78, 71]));
  });
});
