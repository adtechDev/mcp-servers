import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import sharp from 'sharp';

describe('read_media_file', () => {
  let client: Client;
  let transport: StdioClientTransport;
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-fs-media-test-'));

    const serverPath = path.resolve(__dirname, '../dist/index.js');
    transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, testDir],
    });

    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    }, {
      capabilities: {}
    });

    await client.connect(transport);
  });

  afterEach(async () => {
    await client?.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  // Minimal valid PNG: 1x1 pixel
  const PNG_BYTES = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d76360f8cf00000001010000189dd2f40000000049454e44ae426082',
    'hex'
  );

  // Minimal valid JPEG
  const JPEG_BYTES = Buffer.from('ffd8ffe000104a46494600', 'hex');

  it('should detect PNG via magic bytes', async () => {
    const filePath = path.join(testDir, 'image.png');
    await fs.writeFile(filePath, PNG_BYTES);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as { content: Array<{ type: string; mimeType: string; data: string }> };
    expect(structured.content).toHaveLength(1);
    expect(structured.content[0].type).toBe('image');
    expect(structured.content[0].mimeType).toBe('image/png');
    expect(structured.content[0].data).toBe(PNG_BYTES.toString('base64'));
  });

  it('should detect real type via magic bytes even when extension is wrong', async () => {
    // Write PNG data but with .jpg extension
    const filePath = path.join(testDir, 'actually-png.jpg');
    await fs.writeFile(filePath, PNG_BYTES);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as { content: Array<{ type: string; mimeType: string }> };
    expect(structured.content[0].mimeType).toBe('image/png');
    expect(structured.content[0].type).toBe('image');
  });

  it('should detect JPEG via magic bytes regardless of extension', async () => {
    const filePath = path.join(testDir, 'photo.txt');
    await fs.writeFile(filePath, JPEG_BYTES);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as { content: Array<{ type: string; mimeType: string }> };
    expect(structured.content[0].mimeType).toBe('image/jpeg');
    expect(structured.content[0].type).toBe('image');
  });

  it('should fallback to extension for SVG (no magic bytes)', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const filePath = path.join(testDir, 'icon.svg');
    await fs.writeFile(filePath, svgContent);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as { content: Array<{ type: string; mimeType: string }> };
    expect(structured.content[0].mimeType).toBe('image/svg+xml');
    expect(structured.content[0].type).toBe('image');
  });

  it('returns an embedded resource for unknown types (never the invalid "blob" content type)', async () => {
    const filePath = path.join(testDir, 'data.xyz');
    await fs.writeFile(filePath, Buffer.from('some random binary data'));

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    // No magic-bytes match and an unmapped extension -> application/octet-stream,
    // returned as an embedded resource (a valid MCP content block, unlike the
    // old type:"blob" which a strict client rejects on schema validation).
    const structured = result.structuredContent as {
      content: Array<{ type: string; resource?: { mimeType?: string; blob: string } }>
    };
    expect(structured.content[0].type).toBe('resource');
    expect(structured.content[0].resource?.mimeType).toBe('application/octet-stream');
  });

  it('should detect PNG even without extension', async () => {
    const filePath = path.join(testDir, 'noext');
    await fs.writeFile(filePath, PNG_BYTES);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as { content: Array<{ type: string; mimeType: string }> };
    expect(structured.content[0].mimeType).toBe('image/png');
    expect(structured.content[0].type).toBe('image');
  });

  it('does NOT pass through a detected type outside the allow-list (real TIFF named .png -> resource)', async () => {
    // Real TIFF content (file-type detects image/tiff, which is NOT in the supported
    // list) but named .png. Guards the allow-list gate: an out-of-list detected type
    // must be demoted to an opaque octet-stream resource, never surfaced as an image.
    const tiff = Buffer.alloc(256);
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]).copy(tiff);
    const filePath = path.join(testDir, 'actually-tiff.png');
    await fs.writeFile(filePath, tiff);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as {
      content: Array<{ type: string; resource?: { mimeType?: string } }>
    };
    expect(structured.content[0].type).toBe('resource');
    expect(structured.content[0].resource?.mimeType).toBe('application/octet-stream');
  });

  it('downscales an image whose dimensions exceed 2000px (aspect ratio & format preserved)', async () => {
    const filePath = path.join(testDir, 'big.png');
    await sharp({ create: { width: 3000, height: 1500, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .png()
      .toFile(filePath);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as { content: Array<{ type: string; data: string; mimeType: string }> };
    expect(structured.content[0].type).toBe('image');
    expect(structured.content[0].mimeType).toBe('image/png');
    // The returned bytes must be downscaled to fit within 2000px on the long edge,
    // preserving aspect ratio (3000x1500 -> 2000x1000) and format (still PNG).
    const meta = await sharp(Buffer.from(structured.content[0].data, 'base64')).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(1000);
  });

  it('returns an image within 2000px byte-for-byte (no re-encoding)', async () => {
    const filePath = path.join(testDir, 'small.png');
    await sharp({ create: { width: 100, height: 80, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toFile(filePath);
    const original = await fs.readFile(filePath);

    const result = await client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    });

    const structured = result.structuredContent as { content: Array<{ type: string; data: string }> };
    // Small images are streamed unchanged, not re-encoded through sharp.
    expect(Buffer.from(structured.content[0].data, 'base64').equals(original)).toBe(true);
  });
});
