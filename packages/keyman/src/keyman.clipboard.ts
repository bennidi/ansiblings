import { runTool, ToolNotFoundError } from './keyman.utils.js';

/** A clipboard command and the argv it wants, in the order they are tried. */
interface ClipboardTool {
  binary: string;
  args: string[];
}

/**
 * The clipboard commands worth trying on a platform, best first.
 *
 * Linux is a list rather than a choice because there is no single answer:
 * `wl-copy` under Wayland, `xclip`/`xsel` under X11, and a user may have any
 * subset installed. Trying them in order and moving on from an absent one costs a
 * failed spawn and removes the need to detect the session type.
 */
export function clipboardTools(platform: string = process.platform): ClipboardTool[] {
  switch (platform) {
    case 'darwin':
      return [{ binary: 'pbcopy', args: [] }];
    case 'win32':
      return [{ binary: 'clip', args: [] }];
    default:
      return [
        { binary: 'wl-copy', args: [] },
        { binary: 'xclip', args: ['-selection', 'clipboard'] },
        { binary: 'xsel', args: ['--clipboard', '--input'] },
      ];
  }
}

/**
 * Puts `text` on the system clipboard.
 *
 * keyman used to spawn `pbcopy` unconditionally, with a comment saying so — which
 * made "copy public key" a dead end on every platform but macOS, and reported it
 * as a clipboard failure rather than as a missing tool.
 *
 * @returns the command that took it, or null if none was available
 */
export async function copyToClipboard(text: string, platform?: string): Promise<string | null> {
  for (const { binary, args } of clipboardTools(platform)) {
    try {
      await runTool(binary, args, { input: text });
      return binary;
    } catch (error) {
      // Only an absent tool is worth trying the next candidate for. One that ran
      // and refused has an opinion, and repeating the paste elsewhere is not it.
      if (!(error instanceof ToolNotFoundError)) {
        throw error;
      }
    }
  }

  return null;
}
