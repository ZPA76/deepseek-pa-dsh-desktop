param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
if ([IO.Path]::GetDirectoryName($testRoot) -ne $tempRoot -or [IO.Path]::GetFileName($testRoot) -notmatch '^dpa-acp-(handshake|model|cleanup|skill)-[A-Za-z0-9-]+$') {
  throw 'Refusing cleanup outside an explicitly named ACP smoke directory'
}
if (!(Test-Path -LiteralPath $testRoot)) { exit 0 }
if ((Get-Item -Force -LiteralPath $testRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw 'Smoke root must not be a link'
}
function Remove-SmokeEntry([string]$entryPath) {
  $absolute = [IO.Path]::GetFullPath($entryPath)
  if ($absolute -ne $testRoot -and !$absolute.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup escaped smoke root' }
  $entry = Get-Item -Force -LiteralPath $absolute
  if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    # Remove the junction itself, never enumerate or recurse into its target.
    if ($entry.PSIsContainer) { [IO.Directory]::Delete($absolute, $false) }
    else { [IO.File]::Delete($absolute) }
  } elseif ($entry.PSIsContainer) {
    foreach ($child in @(Get-ChildItem -Force -LiteralPath $absolute)) { Remove-SmokeEntry $child.FullName }
    [IO.Directory]::Delete($absolute, $false)
  } else {
    Remove-Item -Force -LiteralPath $absolute
  }
}
Remove-SmokeEntry $testRoot
