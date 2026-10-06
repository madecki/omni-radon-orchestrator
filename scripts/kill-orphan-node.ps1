# Kill Node from system install only (not Cursor / other bundled Node).
$target = 'C:\Program Files\nodejs\node.exe'
$killed = 0
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.ExecutablePath -eq $target) {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    $killed++
  }
}
Write-Host "Stopped $killed process(es): $target"
