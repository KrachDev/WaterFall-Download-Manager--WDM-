Add-Type -MemberDefinition '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);' -Name 'Win32' -Namespace 'Memory'
$procs = Get-Process -Name 'Waterfall' -ErrorAction SilentlyContinue
foreach ($p in $procs) {
    try {
        [Memory.Win32]::EmptyWorkingSet($p.Handle) | Out-Null
    } catch {}
}
Start-Sleep -Milliseconds 300
tasklist | findstr /i 'Waterfall'
