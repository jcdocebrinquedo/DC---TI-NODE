param (
    [Parameter(Mandatory=$true)]
    [string]$Action,

    [Parameter(Mandatory=$false)]
    [string]$Email = '',

    [Parameter(Mandatory=$false)]
    [string]$ConfigFile = '',

    [Parameter(Mandatory=$false)]
    [string]$Slot = '',

    [Parameter(Mandatory=$false)]
    [string]$Key = '',

    [Parameter(Mandatory=$false)]
    [string]$DeletePstFile = '0'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Get-OutlookProfileInfoRaw {
    $versions = @('16.0', '15.0', '14.0')
    $detectedVer = '16.0'
    $defaultProfile = 'Outlook'
    $profilePath = ''

    foreach ($v in $versions) {
        $baseKey = "HKCU:\Software\Microsoft\Office\$v\Outlook"
        if (Test-Path $baseKey) {
            $p = (Get-ItemProperty $baseKey -ErrorAction SilentlyContinue).'DefaultProfile'
            if ($p -and $p.Trim().Length -gt 0) {
                $defaultProfile = $p.Trim()
            }
            $detectedVer = $v
            $profilePath = "Software\Microsoft\Office\$v\Outlook\Profiles\$defaultProfile"
            break
        }
    }

    if (-not $profilePath) {
        $profilePath = "Software\Microsoft\Office\16.0\Outlook\Profiles\Outlook"
    }

    return @{
        office_version = $detectedVer
        default_profile = $defaultProfile
        profile_registry_path = $profilePath
    }
}

function Get-OutlookProfileInfo {
    $raw = Get-OutlookProfileInfoRaw
    $fullProfileReg = "HKCU:\$($raw.profile_registry_path)"
    $existed = Test-Path $fullProfileReg

    $accounts = @()
    $acctRoot = "$fullProfileReg\9375CFF0413111d3B88A00104B2A6676"
    if (Test-Path $acctRoot) {
        Get-ChildItem $acctRoot -ErrorAction SilentlyContinue | ForEach-Object {
            $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
            if ($p.'Account Name' -and ($p.clsid -eq '{ED475411-B0D6-11D2-8C3B-00104B2A6676}' -or $p.clsid -eq '{ED475412-B0D6-11D2-8C3B-00104B2A6676}')) {
                $isPop = ($p.clsid -eq '{ED475411-B0D6-11D2-8C3B-00104B2A6676}')
                $accounts += [PSCustomObject]@{
                    slot = $_.PSChildName
                    account_name = [string]$p.'Account Name'
                    display_name = [string]$p.'Display Name'
                    email = [string]$p.'Email'
                    type = if ($isPop) { 'POP3' } else { 'IMAP' }
                    incoming_server = if ($isPop) { [string]$p.'POP3 Server' } else { [string]$p.'IMAP Server' }
                    incoming_port = if ($isPop) { [int]$p.'POP3 Port' } else { [int]$p.'IMAP Port' }
                    outgoing_server = [string]$p.'SMTP Server'
                    outgoing_port = [int]$p.'SMTP Port'
                    has_password = ($p.'POP3 Password' -or $p.'IMAP Password')
                }
            }
        }
    }

    $dataFiles = @()
    if (Test-Path $fullProfileReg) {
        Get-ChildItem $fullProfileReg -ErrorAction SilentlyContinue | ForEach-Object {
            $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
            if ($p.'001f6700') {
                $pathBytes = $p.'001f6700'
                $pstPath = [System.Text.Encoding]::Unicode.GetString($pathBytes).Trim([char]0)
                $name = if ($p.'001f3001') {
                    [System.Text.Encoding]::Unicode.GetString($p.'001f3001').Trim([char]0)
                } else {
                    [System.IO.Path]::GetFileName($pstPath)
                }
                $exists = Test-Path $pstPath
                $sizeMb = 0
                if ($exists) {
                    try {
                        $len = (Get-Item $pstPath -ErrorAction SilentlyContinue).Length
                        $sizeMb = [Math]::Round($len / 1MB, 2)
                    } catch {}
                }
                $dataFiles += [PSCustomObject]@{
                    key = $_.PSChildName
                    name = $name
                    file_path = $pstPath
                    size_mb = $sizeMb
                    exists = $exists
                }
            }
        }
    }

    [PSCustomObject]@{
        office_version = $raw.office_version
        default_profile = $raw.default_profile
        profile_registry_path = $raw.profile_registry_path
        existed_previously = $existed
        accounts = $accounts
        data_files = $dataFiles
    } | ConvertTo-Json -Depth 4
}

function Find-PstCandidates([string]$targetEmail) {
    $cleanEmail = if ($targetEmail) { $targetEmail.Trim().ToLower() } else { '' }
    $username = if ($cleanEmail -and $cleanEmail.Contains('@')) { $cleanEmail.Split('@')[0] } else { $cleanEmail }

    $candidates = @()
    $searchPaths = @(
        [System.IO.Path]::Combine([System.Environment]::GetFolderPath('MyDocuments'), 'Arquivos do Outlook'),
        [System.IO.Path]::Combine([System.Environment]::GetFolderPath('MyDocuments'), 'Outlook Files'),
        [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Microsoft', 'Outlook')
    )

    $seen = @{}
    foreach ($dir in $searchPaths) {
        if (Test-Path $dir) {
            Get-ChildItem -Path $dir -Filter "*.pst" -File -ErrorAction SilentlyContinue | ForEach-Object {
                $full = $_.FullName
                if (-not $seen[$full.ToLower()]) {
                    $seen[$full.ToLower()] = $true
                    $fn = $_.Name
                    $sizeMb = [Math]::Round($_.Length / 1MB, 2)
                    $mod = $_.LastWriteTime.ToString("dd/MM/yyyy HH:mm:ss")
                    $matches = $false
                    if ($cleanEmail.Length -gt 0 -and $fn.ToLower().Contains($cleanEmail)) {
                        $matches = $true
                    } elseif ($username.Length -gt 0 -and $fn.ToLower().Contains($username)) {
                        $matches = $true
                    }

                    $candidates += [PSCustomObject]@{
                        filename = $fn
                        full_path = $full
                        size_mb = $sizeMb
                        size_bytes = $_.Length
                        modified_at = $mod
                        matches_email = $matches
                    }
                }
            }
        }
    }

    $sorted = $candidates | Sort-Object { -not $_.matches_email }, filename
    if (-not $sorted) { $sorted = @() }
    $sorted | ConvertTo-Json -Depth 3
}

function Remove-EntryIdFromMasterProfile([string]$profileReg, [byte[]]$targetEntryId) {
    $masterPath = "$profileReg\0a0d020000000000c000000000000046"
    if (-not (Test-Path $masterPath)) { return }

    $prop = Get-ItemProperty $masterPath -ErrorAction SilentlyContinue
    $blob = $prop.'1102039b'
    if (-not $blob) { return }

    $count = [System.BitConverter]::ToUInt32($blob, 0)
    $entries = [System.Collections.Generic.List[byte[]]]::new()
    for ($i = 0; $i -lt $count; $i++) {
        $off = [System.BitConverter]::ToUInt32($blob, 8 + $i * 16 + 4)
        $len = [System.BitConverter]::ToUInt32($blob, 8 + $i * 16 + 12)
        if ($len -eq 0 -or $len -gt 10000) {
            $len = $blob.Length - $off
        }
        $item = New-Object byte[] $len
        [System.Array]::Copy($blob, $off, $item, 0, $len)

        $isTarget = $false
        if ($item.Length -eq $targetEntryId.Length) {
            $isTarget = $true
            for ($k = 0; $k -lt $item.Length; $k++) {
                if ($item[$k] -ne $targetEntryId[$k]) { $isTarget = $false; break }
            }
        }
        if (-not $isTarget) {
            $entries.Add($item)
        }
    }

    if ($entries.Count -lt $count) {
        $newCount = $entries.Count
        if ($newCount -eq 0) {
            Remove-ItemProperty -Path $masterPath -Name "1102039b" -ErrorAction SilentlyContinue
            Remove-ItemProperty -Path $masterPath -Name "11020458" -ErrorAction SilentlyContinue
        } else {
            $tableSize = 8 + $newCount * 16 - 4
            $curOff = $tableSize
            $offsets = @()
            $lengths = @()
            for ($i = 0; $i -lt $newCount; $i++) {
                $offsets += $curOff
                $lengths += $entries[$i].Length
                $curOff += $entries[$i].Length
            }

            $newBlob = New-Object byte[] $curOff
            [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$newCount), 0, $newBlob, 0, 4)
            [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$lengths[$newCount - 1]), 0, $newBlob, 4, 4)

            for ($i = 0; $i -lt $newCount; $i++) {
                $baseIdx = 8 + $i * 16
                [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$offsets[$i]), 0, $newBlob, $baseIdx + 4, 4)
                if ($i -lt ($newCount - 1)) {
                    [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$lengths[$i]), 0, $newBlob, $baseIdx + 12, 4)
                }
                [System.Array]::Copy($entries[$i], 0, $newBlob, $offsets[$i], $entries[$i].Length)
            }

            Set-ItemProperty -Path $masterPath -Name "1102039b" -Value $newBlob -Type Binary
            Set-ItemProperty -Path $masterPath -Name "11020458" -Value $newBlob -Type Binary
        }
    }
}

function Remove-OutlookAccount([string]$slotTarget, [bool]$deletePst) {
    $raw = Get-OutlookProfileInfoRaw
    $profileReg = "HKCU:\$($raw.profile_registry_path)"
    $acctsRoot = "$profileReg\9375CFF0413111d3B88A00104B2A6676"
    $acctPath = "$acctsRoot\$slotTarget"

    if (-not (Test-Path $acctPath)) {
        throw "Slot de conta não encontrado no Registro: $slotTarget"
    }

    $acctProps = Get-ItemProperty $acctPath -ErrorAction SilentlyContinue
    $email = [string]$acctProps.'Account Name'
    $deliveryStoreEntryId = $acctProps.'Delivery Store EntryID'
    $acctId = [uint32]([Convert]::ToUInt32($slotTarget, 16))

    # Remove o slot da conta
    Remove-Item -Path $acctPath -Recurse -Force -ErrorAction SilentlyContinue

    # Remove da lista de ordem
    $orderValName = "{ED475420-B0D6-11D2-8C3B-00104B2A6676}"
    $orderBytes = (Get-ItemProperty $acctsRoot -ErrorAction SilentlyContinue).$orderValName
    if ($orderBytes) {
        $acctBytes = [System.BitConverter]::GetBytes($acctId)
        $newOrder = [System.Collections.Generic.List[byte]]::new()
        for ($i = 0; $i -lt $orderBytes.Length; $i += 4) {
            $chunk = New-Object byte[] 4
            [System.Array]::Copy($orderBytes, $i, $chunk, 0, 4)
            if ($chunk[0] -ne $acctBytes[0] -or $chunk[1] -ne $acctBytes[1] -or $chunk[2] -ne $acctBytes[2] -or $chunk[3] -ne $acctBytes[3]) {
                $newOrder.AddRange($chunk)
            }
        }
        Set-ItemProperty -Path $acctsRoot -Name $orderValName -Value $newOrder.ToArray() -Type Binary
    }

    # Procura companion store slot
    $pstPath = ''
    $serviceUidHex = ''
    $storeUidHex = ''

    if (Test-Path $acctsRoot) {
        Get-ChildItem $acctsRoot -ErrorAction SilentlyContinue | ForEach-Object {
            $sp = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
            if ($sp.clsid -eq '{ED475414-B0D6-11D2-8C3B-00104B2A6676}' -and $sp.'Account Name' -eq $email) {
                $storeSlotHex = $_.PSChildName
                $storeId = [uint32]([Convert]::ToUInt32($storeSlotHex, 16))
                $suid = $sp.'Service UID'
                if ($suid) {
                    $serviceUidHex = ($suid | ForEach-Object { '{0:x2}' -f $_ }) -join ''
                }
                Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
                
                $curOrder = (Get-ItemProperty $acctsRoot -ErrorAction SilentlyContinue).$orderValName
                if ($curOrder) {
                    $stBytes = [System.BitConverter]::GetBytes($storeId)
                    $cleanList = [System.Collections.Generic.List[byte]]::new()
                    for ($j = 0; $j -lt $curOrder.Length; $j += 4) {
                        $chunk = New-Object byte[] 4
                        [System.Array]::Copy($curOrder, $j, $chunk, 0, 4)
                        if ($chunk[0] -ne $stBytes[0] -or $chunk[1] -ne $stBytes[1] -or $chunk[2] -ne $stBytes[2] -or $chunk[3] -ne $stBytes[3]) {
                            $cleanList.AddRange($chunk)
                        }
                    }
                    Set-ItemProperty -Path $acctsRoot -Name $orderValName -Value $cleanList.ToArray() -Type Binary
                }
            }
        }
    }

    if ($serviceUidHex) {
        $serviceReg = "$profileReg\$serviceUidHex"
        if (Test-Path $serviceReg) {
            $suidProps = Get-ItemProperty $serviceReg -ErrorAction SilentlyContinue
            $stUid = $suidProps.'01023d00'
            if ($stUid) {
                $storeUidHex = ($stUid | ForEach-Object { '{0:x2}' -f $_ }) -join ''
            }
            Remove-Item -Path $serviceReg -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    if ($storeUidHex) {
        $storeReg = "$profileReg\$storeUidHex"
        if (Test-Path $storeReg) {
            $stProps = Get-ItemProperty $storeReg -ErrorAction SilentlyContinue
            if ($stProps.'001f6700') {
                $pstPath = [System.Text.Encoding]::Unicode.GetString($stProps.'001f6700').Trim([char]0)
            }
            Remove-Item -Path $storeReg -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    if ($deliveryStoreEntryId) {
        Remove-EntryIdFromMasterProfile -profileReg $profileReg -targetEntryId $deliveryStoreEntryId
    }

    $pstDeleted = $false
    $pstDeleteError = $null
    if ($deletePst -and $pstPath -and (Test-Path $pstPath)) {
        try {
            Remove-Item -Path $pstPath -Force -ErrorAction Stop
            $pstDeleted = $true
        } catch {
            $pstDeleteError = $_.Exception.Message
        }
    }

    [PSCustomObject]@{
        removed_account = $email
        removed_slot = $slotTarget
        pst_path = $pstPath
        pst_file_deleted = $pstDeleted
        pst_delete_error = $pstDeleteError
    } | ConvertTo-Json -Depth 2
}

function Remove-OutlookDataFile([string]$keyTarget, [bool]$deletePst) {
    $raw = Get-OutlookProfileInfoRaw
    $profileReg = "HKCU:\$($raw.profile_registry_path)"
    $storeReg = "$profileReg\$keyTarget"

    if (-not (Test-Path $storeReg)) {
        throw "Arquivo de dados não encontrado no perfil do Outlook: $keyTarget"
    }

    $stProps = Get-ItemProperty $storeReg -ErrorAction SilentlyContinue
    $pstPath = ''
    if ($stProps.'001f6700') {
        $pstPath = [System.Text.Encoding]::Unicode.GetString($stProps.'001f6700').Trim([char]0)
    }
    $deliveryStoreEntryId = $stProps.'01020fff'
    $suidBytes = $stProps.'01023d0c'

    Remove-Item -Path $storeReg -Recurse -Force -ErrorAction SilentlyContinue

    if ($suidBytes) {
        $suidHex = ($suidBytes | ForEach-Object { '{0:x2}' -f $_ }) -join ''
        $serviceReg = "$profileReg\$suidHex"
        if (Test-Path $serviceReg) {
            Remove-Item -Path $serviceReg -Recurse -Force -ErrorAction SilentlyContinue
        }

        $acctsRoot = "$profileReg\9375CFF0413111d3B88A00104B2A6676"
        if (Test-Path $acctsRoot) {
            Get-ChildItem $acctsRoot -ErrorAction SilentlyContinue | ForEach-Object {
                $sp = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
                if ($sp.clsid -eq '{ED475414-B0D6-11D2-8C3B-00104B2A6676}' -and $sp.'Service UID') {
                    $curSuidHex = ($sp.'Service UID' | ForEach-Object { '{0:x2}' -f $_ }) -join ''
                    if ($curSuidHex -eq $suidHex) {
                        $stId = [uint32]([Convert]::ToUInt32($_.PSChildName, 16))
                        Remove-Item -Path $_.PSPath -Recurse -Force -ErrorAction SilentlyContinue
                        $orderValName = "{ED475420-B0D6-11D2-8C3B-00104B2A6676}"
                        $curOrder = (Get-ItemProperty $acctsRoot -ErrorAction SilentlyContinue).$orderValName
                        if ($curOrder) {
                            $stBytes = [System.BitConverter]::GetBytes($stId)
                            $cleanList = [System.Collections.Generic.List[byte]]::new()
                            for ($j = 0; $j -lt $curOrder.Length; $j += 4) {
                                $chunk = New-Object byte[] 4
                                [System.Array]::Copy($curOrder, $j, $chunk, 0, 4)
                                if ($chunk[0] -ne $stBytes[0] -or $chunk[1] -ne $stBytes[1] -or $chunk[2] -ne $stBytes[2] -or $chunk[3] -ne $stBytes[3]) {
                                    $cleanList.AddRange($chunk)
                                }
                            }
                            Set-ItemProperty -Path $acctsRoot -Name $orderValName -Value $cleanList.ToArray() -Type Binary
                        }
                    }
                }
            }
        }
    }

    if ($deliveryStoreEntryId) {
        Remove-EntryIdFromMasterProfile -profileReg $profileReg -targetEntryId $deliveryStoreEntryId
    }

    $pstDeleted = $false
    $pstDeleteError = $null
    if ($deletePst -and $pstPath -and (Test-Path $pstPath)) {
        try {
            Remove-Item -Path $pstPath -Force -ErrorAction Stop
            $pstDeleted = $true
        } catch {
            $pstDeleteError = $_.Exception.Message
        }
    }

    [PSCustomObject]@{
        removed_key = $keyTarget
        pst_path = $pstPath
        pst_file_deleted = $pstDeleted
        pst_delete_error = $pstDeleteError
    } | ConvertTo-Json -Depth 2
}

function Invoke-ConfigureEmail([string]$configFilePath) {
    if (-not (Test-Path $configFilePath)) {
        throw "Arquivo de configuração não encontrado: $configFilePath"
    }

    $raw = [System.IO.File]::ReadAllText($configFilePath, [System.Text.Encoding]::UTF8)
    $cfg = $raw | ConvertFrom-Json

    $rawInfo = Get-OutlookProfileInfoRaw
    $detectedVer = $rawInfo.office_version
    $defaultProfile = $rawInfo.default_profile
    $profilePath = $rawInfo.profile_registry_path

    $fullProfileReg = "HKCU:\$profilePath"
    if (-not (Test-Path $fullProfileReg)) {
        New-Item -Path $fullProfileReg -Force | Out-Null
    }

    # Determina o arquivo PST
    $pstMode = 'created_new'
    $pstPath = ''
    if ($cfg.useExistingPst -and $cfg.existingPstPath -and (Test-Path $cfg.existingPstPath)) {
        $pstPath = [System.IO.Path]::GetFullPath($cfg.existingPstPath)
        $pstMode = 'linked_existing'
    } else {
        $docsDir = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('MyDocuments'), 'Arquivos do Outlook')
        if (-not (Test-Path $docsDir)) {
            New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
        }
        $sanitized = ($cfg.emailAddress -replace '[^a-zA-Z0-9_\-\.]', '_')
        $pstPath = [System.IO.Path]::Combine($docsDir, "$sanitized.pst")
    }

    # Criptografia DPAPI com prefixo 0x02
    $passBytes = [System.Text.Encoding]::Unicode.GetBytes($cfg.password)
    $protected = [System.Security.Cryptography.ProtectedData]::Protect($passBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $encryptedPasswordBlob = New-Object byte[] ($protected.Length + 1)
    $encryptedPasswordBlob[0] = 0x02
    [System.Array]::Copy($protected, 0, $encryptedPasswordBlob, 1, $protected.Length)

    # Header MSPST
    $mspstHeader = [byte[]](
        0x00,0x00,0x00,0x00,
        0x38,0xa1,0xbb,0x10,0x05,0xe5,0x10,0x1a,0xa1,0xbb,0x08,0x00,0x2b,0x2a,0x56,0xc2,
        0x00,0x00,
        0x6d,0x73,0x70,0x73,0x74,0x2e,0x64,0x6c,0x6c,0x00,
        0x00,0x00,0x00,0x00,
        0x4e,0x49,0x54,0x41,
        0xf9,0xbf,0xb8,0x01,0x00,0xaa,0x00,0x37,0xd9,0x6e,
        0x00,0x00,0x00,0x00
    )
    $pathUnicode = [System.Text.Encoding]::Unicode.GetBytes($pstPath + "`0")
    $deliveryStoreEntryId = New-Object byte[] ($mspstHeader.Length + $pathUnicode.Length)
    [System.Array]::Copy($mspstHeader, 0, $deliveryStoreEntryId, 0, $mspstHeader.Length)
    [System.Array]::Copy($pathUnicode, 0, $deliveryStoreEntryId, $mspstHeader.Length, $pathUnicode.Length)

    # Slots
    $acctsRootPath = "$fullProfileReg\9375CFF0413111d3B88A00104B2A6676"
    if (-not (Test-Path $acctsRootPath)) {
        New-Item -Path $acctsRootPath -Force | Out-Null
    }

    $nextId = (Get-ItemProperty $acctsRootPath -ErrorAction SilentlyContinue).'NextAccountID'
    if (-not $nextId) { $nextId = 2 }

    $allocatedAcct = $null
    $allocatedStore = $null
    $candidateId = [uint32]$nextId

    while ($true) {
        $hex = "{0:x8}" -f $candidateId
        $sub = "$acctsRootPath\$hex"
        if (-not (Test-Path $sub)) {
            if (-not $allocatedAcct) {
                $allocatedAcct = @{ Id = $candidateId; Hex = $hex }
            } elseif (-not $allocatedStore) {
                $allocatedStore = @{ Id = $candidateId; Hex = $hex }
                $candidateId++
                break
            }
        }
        $candidateId++
    }

    Set-ItemProperty -Path $acctsRootPath -Name "NextAccountID" -Value $candidateId -Type DWord

    # Order list {ED475420-B0D6-11D2-8C3B-00104B2A6676}
    $orderValName = "{ED475420-B0D6-11D2-8C3B-00104B2A6676}"
    $orderBytes = (Get-ItemProperty $acctsRootPath -ErrorAction SilentlyContinue).$orderValName
    if (-not $orderBytes) { $orderBytes = [byte[]]@() }
    $newOrder = [System.Collections.Generic.List[byte]]::new($orderBytes)
    $newOrder.AddRange([System.BitConverter]::GetBytes([uint32]$allocatedAcct.Id))
    $newOrder.AddRange([System.BitConverter]::GetBytes([uint32]$allocatedStore.Id))
    Set-ItemProperty -Path $acctsRootPath -Name $orderValName -Value $newOrder.ToArray() -Type Binary

    # GUIDs
    $serviceUid = [System.Guid]::NewGuid().ToByteArray()
    $serviceUidHex = ($serviceUid | ForEach-Object { '{0:x2}' -f $_ }) -join ''
    $storeUid = [System.Guid]::NewGuid().ToByteArray()
    $storeUidHex = ($storeUid | ForEach-Object { '{0:x2}' -f $_ }) -join ''
    $accountUid = [System.Guid]::NewGuid().ToByteArray()
    $prefsUid = [System.Guid]::NewGuid().ToByteArray()

    # Conta
    $acctKeyPath = "$acctsRootPath\$($allocatedAcct.Hex)"
    New-Item -Path $acctKeyPath -Force | Out-Null

    $inSslDword = if ($cfg.incomingUseSSL) { 1 } else { 0 }
    $outSslDword = if ($cfg.outgoingUseSSL) { 1 } else { 0 }
    $outSecConnDword = if ($cfg.outgoingUseSSL) { 2 } else { 0 }
    $outAuthDword = if ($cfg.outgoingRequireAuth) { 1 } else { 0 }
    $inPortDword = [uint32]$cfg.incomingPort
    $outPortDword = [uint32]$cfg.outgoingPort

    $isImap = ($cfg.accountType -eq 'Imap')
    if ($isImap) {
        Set-ItemProperty -Path $acctKeyPath -Name "clsid" -Value "{ED475412-B0D6-11D2-8C3B-00104B2A6676}"
        Set-ItemProperty -Path $acctKeyPath -Name "Service Name" -Value "IMAP/SMTP"
        Set-ItemProperty -Path $acctKeyPath -Name "IMAP Server" -Value $cfg.incomingServer
        Set-ItemProperty -Path $acctKeyPath -Name "IMAP Port" -Value $inPortDword -Type DWord
        Set-ItemProperty -Path $acctKeyPath -Name "IMAP Use SSL" -Value $inSslDword -Type DWord
        Set-ItemProperty -Path $acctKeyPath -Name "IMAP User" -Value $cfg.emailAddress
        Set-ItemProperty -Path $acctKeyPath -Name "IMAP Password" -Value $encryptedPasswordBlob -Type Binary
    } else {
        Set-ItemProperty -Path $acctKeyPath -Name "clsid" -Value "{ED475411-B0D6-11D2-8C3B-00104B2A6676}"
        Set-ItemProperty -Path $acctKeyPath -Name "Service Name" -Value "POP3/SMTP"
        Set-ItemProperty -Path $acctKeyPath -Name "POP3 Server" -Value $cfg.incomingServer
        Set-ItemProperty -Path $acctKeyPath -Name "POP3 Port" -Value $inPortDword -Type DWord
        Set-ItemProperty -Path $acctKeyPath -Name "POP3 Use SSL" -Value $inSslDword -Type DWord
        Set-ItemProperty -Path $acctKeyPath -Name "POP3 User" -Value $cfg.emailAddress
        Set-ItemProperty -Path $acctKeyPath -Name "POP3 Password" -Value $encryptedPasswordBlob -Type Binary
        Set-ItemProperty -Path $acctKeyPath -Name "Leave on Server" -Value 917507 -Type DWord
    }

    Set-ItemProperty -Path $acctKeyPath -Name "Account Name" -Value $cfg.emailAddress
    Set-ItemProperty -Path $acctKeyPath -Name "Display Name" -Value $cfg.displayName
    Set-ItemProperty -Path $acctKeyPath -Name "Email" -Value $cfg.emailAddress

    Set-ItemProperty -Path $acctKeyPath -Name "SMTP Server" -Value $cfg.outgoingServer
    Set-ItemProperty -Path $acctKeyPath -Name "SMTP Port" -Value $outPortDword -Type DWord
    Set-ItemProperty -Path $acctKeyPath -Name "SMTP Use SSL" -Value $outSslDword -Type DWord
    Set-ItemProperty -Path $acctKeyPath -Name "SMTP Secure Connection" -Value $outSecConnDword -Type DWord
    Set-ItemProperty -Path $acctKeyPath -Name "SMTP Use Auth" -Value $outAuthDword -Type DWord
    Set-ItemProperty -Path $acctKeyPath -Name "SMTP User" -Value $cfg.emailAddress
    Set-ItemProperty -Path $acctKeyPath -Name "SMTP Password" -Value $encryptedPasswordBlob -Type Binary

    Set-ItemProperty -Path $acctKeyPath -Name "Delivery Store EntryID" -Value $deliveryStoreEntryId -Type Binary
    $deliveryFolderEntryId = [byte[]](0x00,0x00,0x00,0x00,0x1a,0x4c,0x93,0x00,0x08,0x08,0x30,0x44,0xa9,0x86,0xff,0x35,0x80,0xff,0xca,0xa5,0x82,0x80,0x00,0x00)
    Set-ItemProperty -Path $acctKeyPath -Name "Delivery Folder EntryID" -Value $deliveryFolderEntryId -Type Binary
    Set-ItemProperty -Path $acctKeyPath -Name "Account UID" -Value $accountUid -Type Binary
    Set-ItemProperty -Path $acctKeyPath -Name "Preferences UID" -Value $prefsUid -Type Binary
    Set-ItemProperty -Path $acctKeyPath -Name "Mini UID" -Value ([System.BitConverter]::ToUInt32($accountUid, 0)) -Type DWord

    # Store slot
    $storeKeyPath = "$acctsRootPath\$($allocatedStore.Hex)"
    New-Item -Path $storeKeyPath -Force | Out-Null
    Set-ItemProperty -Path $storeKeyPath -Name "clsid" -Value "{ED475414-B0D6-11D2-8C3B-00104B2A6676}"
    Set-ItemProperty -Path $storeKeyPath -Name "Service UID" -Value $serviceUid -Type Binary
    Set-ItemProperty -Path $storeKeyPath -Name "Service Name" -Value "MSUPST MS"
    Set-ItemProperty -Path $storeKeyPath -Name "MAPI Provider" -Value 4 -Type DWord
    Set-ItemProperty -Path $storeKeyPath -Name "Account Name" -Value $cfg.emailAddress
    Set-ItemProperty -Path $storeKeyPath -Name "Preferences UID" -Value $prefsUid -Type Binary
    Set-ItemProperty -Path $storeKeyPath -Name "Mini UID" -Value ([System.BitConverter]::ToUInt32($serviceUid, 0)) -Type DWord

    # Service UID Key
    $serviceRegPath = "$fullProfileReg\$serviceUidHex"
    New-Item -Path $serviceRegPath -Force | Out-Null
    Set-ItemProperty -Path $serviceRegPath -Name "001f3d0a" -Value ([System.Text.Encoding]::Unicode.GetBytes("mspst.dll`0")) -Type Binary
    Set-ItemProperty -Path $serviceRegPath -Name "001f3d13" -Value ([System.Text.Encoding]::Unicode.GetBytes("{6485D262-C2AC-11D1-AD3E-10A0C911C9C0}`0")) -Type Binary
    Set-ItemProperty -Path $serviceRegPath -Name "101e3d0f" -Value ([byte[]](0x01,0x00,0x00,0x00,0x0c,0x00,0x00,0x00,0x6d,0x73,0x70,0x73,0x74,0x2e,0x64,0x6c,0x6c,0x00,0x00,0x00,0x00,0x00)) -Type Binary
    Set-ItemProperty -Path $serviceRegPath -Name "001f3d0b" -Value ([System.Text.Encoding]::Unicode.GetBytes("PSTServiceEntry`0")) -Type Binary
    Set-ItemProperty -Path $serviceRegPath -Name "00033009" -Value ([byte[]](0x20,0x00,0x00,0x00)) -Type Binary
    Set-ItemProperty -Path $serviceRegPath -Name "001f3d09" -Value ([System.Text.Encoding]::Unicode.GetBytes("MSUPST MS`0")) -Type Binary
    Set-ItemProperty -Path $serviceRegPath -Name "001f3001" -Value ([System.Text.Encoding]::Unicode.GetBytes($cfg.emailAddress + "`0")) -Type Binary
    Set-ItemProperty -Path $serviceRegPath -Name "01023d00" -Value $storeUid -Type Binary

    # Store UID Key
    $storeRegPath = "$fullProfileReg\$storeUidHex"
    New-Item -Path $storeRegPath -Force | Out-Null
    Set-ItemProperty -Path $storeRegPath -Name "001f6700" -Value ([System.Text.Encoding]::Unicode.GetBytes($pstPath + "`0")) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "001f3001" -Value ([System.Text.Encoding]::Unicode.GetBytes($cfg.emailAddress + "`0")) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "001f3006" -Value ([System.Text.Encoding]::Unicode.GetBytes("Arquivo de Dados do Outlook`0")) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "001f300a" -Value ([System.Text.Encoding]::Unicode.GetBytes("mspst.dll`0")) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "001f3d09" -Value ([System.Text.Encoding]::Unicode.GetBytes("MSUPST MS`0")) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "001f3d13" -Value ([System.Text.Encoding]::Unicode.GetBytes("{6485D262-C2AC-11D1-AD3E-10A0C911C9C0}`0")) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "00033009" -Value ([byte[]](0x20,0x00,0x00,0x00)) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "00033e03" -Value ([byte[]](0x21,0x00,0x00,0x00)) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "00036770" -Value ([byte[]](0x01,0x00,0x00,0x80)) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "00036702" -Value ([byte[]](0x01,0x00,0x00,0x00)) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "01020fff" -Value $deliveryStoreEntryId -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "01023414" -Value ([byte[]](0x4e,0x49,0x54,0x41,0xf9,0xbf,0xb8,0x01,0x00,0xaa,0x00,0x37,0xd9,0x6e,0x00,0x00)) -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "01023d0c" -Value $serviceUid -Type Binary
    Set-ItemProperty -Path $storeRegPath -Name "01020ff9" -Value ([System.Guid]::NewGuid().ToByteArray()) -Type Binary

    # Master Profile 0a0d020000000000c000000000000046
    $masterKeyPath = "$fullProfileReg\0a0d020000000000c000000000000046"
    if (Test-Path $masterKeyPath) {
        $masterProp = Get-ItemProperty $masterKeyPath -ErrorAction SilentlyContinue
        $existingBlob = $masterProp.'1102039b'
        if ($existingBlob) {
            $count = [System.BitConverter]::ToUInt32($existingBlob, 0)
            $entries = [System.Collections.Generic.List[byte[]]]::new()
            for ($i = 0; $i -lt $count; $i++) {
                $off = [System.BitConverter]::ToUInt32($existingBlob, 8 + $i * 16 + 4)
                $len = [System.BitConverter]::ToUInt32($existingBlob, 8 + $i * 16 + 12)
                if ($len -eq 0 -or $len -gt 10000) {
                    $len = $existingBlob.Length - $off
                }
                $item = New-Object byte[] $len
                [System.Array]::Copy($existingBlob, $off, $item, 0, $len)
                $entries.Add($item)
            }

            $alreadyInMaster = $false
            foreach ($e in $entries) {
                if ($e.Length -eq $deliveryStoreEntryId.Length) {
                    $same = $true
                    for ($j = 0; $j -lt $e.Length; $j++) {
                        if ($e[$j] -ne $deliveryStoreEntryId[$j]) { $same = $false; break }
                    }
                    if ($same) { $alreadyInMaster = $true; break }
                }
            }

            if (-not $alreadyInMaster) {
                $entries.Add($deliveryStoreEntryId)
                $newCount = $entries.Count
                $tableSize = 8 + $newCount * 16 - 4
                
                $curOff = $tableSize
                $offsets = @()
                $lengths = @()
                for ($i = 0; $i -lt $newCount; $i++) {
                    $offsets += $curOff
                    $lengths += $entries[$i].Length
                    $curOff += $entries[$i].Length
                }

                $newBlob = New-Object byte[] $curOff
                [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$newCount), 0, $newBlob, 0, 4)
                [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$lengths[$newCount - 1]), 0, $newBlob, 4, 4)

                for ($i = 0; $i -lt $newCount; $i++) {
                    $baseIdx = 8 + $i * 16
                    [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$offsets[$i]), 0, $newBlob, $baseIdx + 4, 4)
                    if ($i -lt ($newCount - 1)) {
                        [System.Array]::Copy([System.BitConverter]::GetBytes([uint32]$lengths[$i]), 0, $newBlob, $baseIdx + 12, 4)
                    }
                    [System.Array]::Copy($entries[$i], 0, $newBlob, $offsets[$i], $entries[$i].Length)
                }

                Set-ItemProperty -Path $masterKeyPath -Name "1102039b" -Value $newBlob -Type Binary
                Set-ItemProperty -Path $masterKeyPath -Name "11020458" -Value $newBlob -Type Binary
            }
        }
    }

    # XML Autodiscover
    $targetXmlDir = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft', 'Outlook')
    if (-not (Test-Path $targetXmlDir)) { New-Item -ItemType Directory -Path $targetXmlDir -Force | Out-Null }
    $xmlFile = [System.IO.Path]::Combine($targetXmlDir, "autodiscover-$($cfg.domain).xml")

    $protoType = if ($isImap) { 'IMAP' } else { 'POP3' }
    $sslIn = if ($cfg.incomingUseSSL) { 'on' } else { 'off' }
    $sslOut = if ($cfg.outgoingUseSSL) { 'on' } else { 'off' }

    $xmlContent = @"
<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a">
    <User>
      <DisplayName>$([System.Security.SecurityElement]::Escape($cfg.displayName))</DisplayName>
    </User>
    <Account>
      <AccountType>email</AccountType>
      <Action>settings</Action>
      <Protocol>
        <Type>$protoType</Type>
        <Server>$([System.Security.SecurityElement]::Escape($cfg.incomingServer))</Server>
        <Port>$($cfg.incomingPort)</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>$([System.Security.SecurityElement]::Escape($cfg.emailAddress))</LoginName>
        <SPA>off</SPA>
        <SSL>$sslIn</SSL>
        <AuthRequired>on</AuthRequired>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>$([System.Security.SecurityElement]::Escape($cfg.outgoingServer))</Server>
        <Port>$($cfg.outgoingPort)</Port>
        <DomainRequired>off</DomainRequired>
        <LoginName>$([System.Security.SecurityElement]::Escape($cfg.emailAddress))</LoginName>
        <SPA>off</SPA>
        <SSL>$sslOut</SSL>
        <AuthRequired>on</AuthRequired>
        <UsePOPAuth>on</UsePOPAuth>
        <SMTPLast>off</SMTPLast>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>
"@
    [System.IO.File]::WriteAllText($xmlFile, $xmlContent, [System.Text.Encoding]::UTF8)

    $adKey = "HKCU:\Software\Microsoft\Office\$detectedVer\Outlook\AutoDiscover"
    if (-not (Test-Path $adKey)) { New-Item -Path $adKey -Force | Out-Null }
    Set-ItemProperty -Path $adKey -Name $cfg.domain -Value $xmlFile
    Set-ItemProperty -Path $adKey -Name "PreferLocalXml" -Value 1 -Type DWord
    Set-ItemProperty -Path $adKey -Name "ExcludeExplicitO365Endpoint" -Value 1 -Type DWord

    [PSCustomObject]@{
        office_version = $detectedVer
        profile_name = $defaultProfile
        account_index_hex = $allocatedAcct.Hex
        store_index_hex = $allocatedStore.Hex
        account_registry_path = "HKCU:\$profilePath\9375CFF0413111d3B88A00104B2A6676\$($allocatedAcct.Hex)"
        data_store_path = $pstPath
        pst_mode = $pstMode
        password_encrypted = $true
        autodiscover_xml_path = $xmlFile
        incoming_endpoint = "$protoType $($cfg.incomingServer):$($cfg.incomingPort) (SSL=$($cfg.incomingUseSSL))"
        outgoing_endpoint = "SMTP $($cfg.outgoingServer):$($cfg.outgoingPort) (SSL/TLS=$($cfg.outgoingUseSSL))"
    } | ConvertTo-Json -Depth 3
}

switch ($Action) {
    'DetectProfile' {
        Get-OutlookProfileInfo
    }
    'FindPstCandidates' {
        Find-PstCandidates -targetEmail $Email
    }
    'ConfigureEmail' {
        Invoke-ConfigureEmail -configFilePath $ConfigFile
    }
    'RemoveAccount' {
        $del = ($DeletePstFile -eq '1' -or $DeletePstFile -eq 'true' -or $DeletePstFile -eq '$true')
        Remove-OutlookAccount -slotTarget $Slot -deletePst $del
    }
    'RemoveDataFile' {
        $del = ($DeletePstFile -eq '1' -or $DeletePstFile -eq 'true' -or $DeletePstFile -eq '$true')
        Remove-OutlookDataFile -keyTarget $Key -deletePst $del
    }
    default {
        throw "Ação desconhecida: $Action"
    }
}
