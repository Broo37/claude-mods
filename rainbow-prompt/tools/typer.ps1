# Types a text into the console of ONE process, by its id, without touching the keyboard
# focus: it attaches to that process's console and writes key events into its input.
# `{ENTER}` in the text is the Enter key, with a pause after it for what it set off, and
# `{WAIT}` types nothing for four seconds, and `{DOWN}` is the down arrow.
param([uint32]$TargetPid, [string]$Text, [int]$DelayMs = 40)

$Text = $Text.Replace('{ENTER}', [string][char]13).Replace('{WAIT}', [string][char]1).Replace('{DOWN}', [string][char]2)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class Typer {
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool WriteConsoleInputW(IntPtr handle, INPUT_RECORD[] records, uint length, out uint written);

  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
  public struct KEY_EVENT_RECORD {
    [FieldOffset(0)] public int bKeyDown;
    [FieldOffset(4)] public ushort wRepeatCount;
    [FieldOffset(6)] public ushort wVirtualKeyCode;
    [FieldOffset(8)] public ushort wVirtualScanCode;
    [FieldOffset(10)] public char UnicodeChar;
    [FieldOffset(12)] public uint dwControlKeyState;
  }

  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
  public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
  }

  public static string Type(uint pid, string text, int delayMs) {
    FreeConsole();
    if (!AttachConsole(pid)) return "attach failed " + Marshal.GetLastWin32Error();
    IntPtr input = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (input == new IntPtr(-1)) return "open failed " + Marshal.GetLastWin32Error();
    foreach (char letter in text) {
      if (letter == '\u0001') { Thread.Sleep(4000); continue; }
      var records = new INPUT_RECORD[2];
      records[0].EventType = 1;
      records[0].KeyEvent.bKeyDown = 1;
      records[0].KeyEvent.wRepeatCount = 1;
      records[0].KeyEvent.UnicodeChar = letter;
      if (letter == '\r') { records[0].KeyEvent.wVirtualKeyCode = 13; records[0].KeyEvent.wVirtualScanCode = 28; }
      // The down arrow is a key with no character: an enhanced key, code 40.
      if (letter == '\u0002') { records[0].KeyEvent.UnicodeChar = '\0'; records[0].KeyEvent.wVirtualKeyCode = 40; records[0].KeyEvent.wVirtualScanCode = 80; records[0].KeyEvent.dwControlKeyState = 0x0100; }
      records[1] = records[0];
      records[1].KeyEvent.bKeyDown = 0;
      uint written;
      if (!WriteConsoleInputW(input, records, 2, out written)) return "write failed " + Marshal.GetLastWin32Error();
      Thread.Sleep(letter == '\r' ? 1500 : delayMs);
    }
    return "typed " + text.Length;
  }
}
'@

[Typer]::Type($TargetPid, $Text, $DelayMs)
