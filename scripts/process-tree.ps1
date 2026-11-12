param([int]$RootPid, [long]$LaunchMs)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class ProbeProcessTree {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
  struct Entry { public uint size, usage, pid; public IntPtr heap; public uint module, threads, parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe; }
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern bool Process32First(IntPtr handle, ref Entry entry);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern bool Process32Next(IntPtr handle, ref Entry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static Dictionary<int,int> Snapshot() {
    var result = new Dictionary<int,int>(); var h = CreateToolhelp32Snapshot(2,0);
    if (h == new IntPtr(-1)) throw new Exception("Process snapshot unavailable");
    try { var e = new Entry(); e.size=(uint)Marshal.SizeOf(e); if(Process32First(h,ref e)) do { result[(int)e.pid]=(int)e.parent; } while(Process32Next(h,ref e)); }
    finally { CloseHandle(h); } return result;
  }
}
'@
$map = [ProbeProcessTree]::Snapshot()
# A reused root PID is not our process and must never seed a new process tree.
try {
  $root = [System.Diagnostics.Process]::GetProcessById($RootPid)
  $rootStart = [DateTimeOffset]::new($root.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
  if ([Math]::Abs($rootStart - $LaunchMs) -gt 250) { throw 'Root PID was reused' }
} catch [System.ArgumentException] { } # Original parent has already exited; parent IDs remain in the snapshot.
$owned = [System.Collections.Generic.HashSet[int]]::new()
[void]$owned.Add($RootPid)
$result = [System.Collections.Generic.List[int]]::new()
$handles = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
do {
  $changed = $false
  foreach ($entry in $map.GetEnumerator()) {
    if (!$owned.Contains($entry.Key) -and $owned.Contains($entry.Value)) {
      try {
        $p = [System.Diagnostics.Process]::GetProcessById($entry.Key)
        $start = [DateTimeOffset]::new($p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
        if ($start -ge ($LaunchMs - 50)) {
          # Retain a kernel handle so the PID cannot be recycled before termination.
          $null = $p.Handle
          $handles.Add($p)
          [void]$owned.Add($entry.Key); $result.Add($entry.Key); $changed = $true
        } else { $p.Dispose() }
      } catch { }
    }
  }
} while ($changed)
try {
  foreach ($p in $handles) { try { if (!$p.HasExited) { $p.Kill() } } catch { } }
  foreach ($p in $handles) { try { $null = $p.WaitForExit(100) } catch { } }
  ConvertTo-Json -Compress -InputObject @($result.ToArray())
} finally { foreach ($p in $handles) { $p.Dispose() } }
