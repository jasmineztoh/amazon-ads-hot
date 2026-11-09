$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $project '.local/deepseek-key.xml'
Write-Host 'DeepSeek API Key - hidden input for this website only.'
Write-Host 'The key will be encrypted for your Windows account, then configured as a Sites server secret.'
$secret = Read-Host 'Paste API Key and press Enter' -AsSecureString
if ($secret.Length -lt 16) { throw 'The key is empty or incomplete.' }
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
$secret | Export-Clixml -LiteralPath $destination
Write-Host 'Saved securely. Return to Codex and say: key is ready.'
Read-Host 'Press Enter to close'
