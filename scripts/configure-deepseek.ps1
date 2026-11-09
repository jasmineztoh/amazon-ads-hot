$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$project = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $project '.local/deepseek-key.xml'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'DeepSeek API Key'
$form.ClientSize = New-Object System.Drawing.Size(490, 200)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$label = New-Object System.Windows.Forms.Label
$label.Text = "Paste your DeepSeek API Key below, then click Save.`nFor this website only. Stored encrypted, then sent to Sites server secrets."
$label.Location = New-Object System.Drawing.Point(18, 18)
$label.Size = New-Object System.Drawing.Size(450, 42)
$inputBox = New-Object System.Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true
$inputBox.Location = New-Object System.Drawing.Point(18, 72)
$inputBox.Size = New-Object System.Drawing.Size(450, 30)
$save = New-Object System.Windows.Forms.Button
$save.Text = 'Save'
$save.Location = New-Object System.Drawing.Point(368, 115)
$save.Size = New-Object System.Drawing.Size(100, 32)
$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(18, 157)
$status.Size = New-Object System.Drawing.Size(450, 30)
$save.Add_Click({
  if ($inputBox.Text.Trim().Length -lt 16) { $status.Text = 'The key is empty or incomplete. Please paste the full key.'; return }
  try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    $inputBox.Text.Trim() | ConvertTo-SecureString -AsPlainText -Force | Export-Clixml -LiteralPath $destination
    $inputBox.Clear()
    $status.Text = 'Saved securely. Return to Codex and say: key is ready.'
    $save.Enabled = $false
  } catch { $status.Text = 'Could not save. Tell Codex: save failed.' }
})
$form.Controls.AddRange(@($label, $inputBox, $save, $status))
$form.AcceptButton = $save
$form.Add_Shown({ $inputBox.Focus() })
[void]$form.ShowDialog()
$form.Dispose()
