Get-CimInstance Win32_Process | Where-Object { $_.Name -like "*Waterfall*" } | Select-Object ProcessId, ExecutablePath | Format-Table -AutoSize
