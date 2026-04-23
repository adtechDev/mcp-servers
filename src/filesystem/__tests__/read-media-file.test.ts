import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

  it('should error for unknown type (blob is not a valid MCP content type)', async () => {
    const filePath = path.join(testDir, 'data.xyz');
    await fs.writeFile(filePath, Buffer.from('some random binary data'));

    await expect(client.callTool({
      name: 'read_media_file',
      arguments: { path: filePath }
    })).rejects.toThrow();
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
});
