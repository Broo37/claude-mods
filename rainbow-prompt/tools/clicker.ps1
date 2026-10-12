# Clicks the left mouse button on one cell of the console of ONE process, by its id,
# without moving the real mouse: it attaches to that process's console and writes mouse
# events into its input. X is the column and Y the row, both from 0.
param([uint32]$TargetPid, [int]$X, [int]$Y)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class Clicker {
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool WriteConsoleInputW(IntPtr handle, INPUT_RECORD[] records, uint length, out uint written);

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSE_EVENT_RECORD {
    public short X;
    public short Y;
    public uint dwButtonState;
    public uint dwControlKeyState;
    public uint dwEventFlags;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public MOUSE_EVENT_RECORD MouseEvent;
  }

  static INPUT_RECORD At(short x, short y, uint buttons, uint flags) {
    var record = new INPUT_RECORD();
    record.EventType = 2;
    record.MouseEvent.X = x;
    record.MouseEvent.Y = y;
    record.MouseEvent.dwButtonState = buttons;
    record.MouseEvent.dwEventFlags = flags;
    return record;
  }

  public static string Click(uint pid, short x, short y) {
    FreeConsole();
    if (!AttachConsole(pid)) return "attach failed " + Marshal.GetLastWin32Error();
    IntPtr input = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (input == new IntPtr(-1)) return "open failed " + Marshal.GetLastWin32Error();
    uint written;
    // The pointer comes to the cell, the button goes down, and it comes up again.
    var steps = new[] { At(x, y, 0, 1), At(x, y, 1, 0), At(x, y, 0, 0) };
    foreach (var step in steps) {
      if (!WriteConsoleInputW(input, new[] { step }, 1, out written)) return "write failed " + Marshal.GetLastWin32Error();
      Thread.Sleep(60);
    }
    return "clicked " + x + "," + y;
  }
}
'@

[Clicker]::Click($TargetPid, [int16]$X, [int16]$Y)
