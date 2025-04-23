!addplugindir "$%AppData%\Local\NSIS\"

!macro NSIS_HOOK_PREINSTALL
  ; MessageBox MB_OK "PreInstall"
!macroend

!macro NSIS_HOOK_PREINSTALL_APPSTOPED
  !insertmacro CheckAllVergeProcesses
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro StartVergeService
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CheckAllVergeProcesses
  !insertmacro RemoveVergeService
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; MessageBox MB_OK "PostUninstall"
!macroend

!macro CheckAllVergeProcesses
  ; Check if clash-verge-service.exe is running
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "clash-verge-service.exe"
  !else
    nsis_tauri_utils::FindProcess "clash-verge-service.exe"
  !endif
  Pop $R0
  ${If} $R0 = 0
    DetailPrint "Kill clash-verge-service.exe..."
    !if "${INSTALLMODE}" == "currentUser"
      nsis_tauri_utils::KillProcessCurrentUser "clash-verge-service.exe"
    !else
      nsis_tauri_utils::KillProcess "clash-verge-service.exe"
    !endif
  ${EndIf}

  ; Check if verge-mihomo-alpha.exe is running
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "verge-mihomo-alpha.exe"
  !else
    nsis_tauri_utils::FindProcess "verge-mihomo-alpha.exe"
  !endif
  Pop $R0
  ${If} $R0 = 0
    DetailPrint "Kill verge-mihomo-alpha.exe..."
    !if "${INSTALLMODE}" == "currentUser"
      nsis_tauri_utils::KillProcessCurrentUser "verge-mihomo-alpha.exe"
    !else
      nsis_tauri_utils::KillProcess "verge-mihomo-alpha.exe"
    !endif
  ${EndIf}

  ; Check if verge-mihomo.exe is running
  !if "${INSTALLMODE}" == "currentUser"
    nsis_tauri_utils::FindProcessCurrentUser "verge-mihomo.exe"
  !else
    nsis_tauri_utils::FindProcess "verge-mihomo.exe"
  !endif
  Pop $R0
  ${If} $R0 = 0
    DetailPrint "Kill verge-mihomo.exe..."
    !if "${INSTALLMODE}" == "currentUser"
      nsis_tauri_utils::KillProcessCurrentUser "verge-mihomo.exe"
    !else
      nsis_tauri_utils::KillProcess "verge-mihomo.exe"
    !endif
  ${EndIf}
!macroend

!macro StartVergeService
  ; Check if the service exists
  SimpleSC::ExistsService "clash_verge_service"
  Pop $0  ; 0：service exists；other: service not exists
  ; Service exists
  ${If} $0 == 0
    Push $0
    ; Check if the service is running
    SimpleSC::ServiceIsRunning "clash_verge_service"
    Pop $0 ; returns an errorcode (<>0) otherwise success (0)
    Pop $1 ; returns 1 (service is running) - returns 0 (service is not running)
    ${If} $0 == 0
      Push $0
      ${If} $1 == 0
            DetailPrint "Restart Clash Verge Service..."
            SimpleSC::StartService "clash_verge_service" "" 30
      ${EndIf}
    ${ElseIf} $0 != 0
          Push $0
          SimpleSC::GetErrorMessage
          Pop $0
          MessageBox MB_OK|MB_ICONSTOP "Check Service Status Error ($0)"
    ${EndIf}
  ${EndIf}
!macroend

!macro RemoveVergeService
  ; Check if the service exists
  SimpleSC::ExistsService "clash_verge_service"
  Pop $0  ; 0：service exists；other: service not exists
  ; Service exists
  ${If} $0 == 0
    Push $0
    ; Check if the service is running
    SimpleSC::ServiceIsRunning "clash_verge_service"
    Pop $0 ; returns an errorcode (<>0) otherwise success (0)
    Pop $1 ; returns 1 (service is running) - returns 0 (service is not running)
    ${If} $0 == 0
      Push $0
      ${If} $1 == 1
        DetailPrint "Stop Clash Verge Service..."
        SimpleSC::StopService "clash_verge_service" 1 30
        Pop $0 ; returns an errorcode (<>0) otherwise success (0)
        ${If} $0 == 0
              DetailPrint "Removing Clash Verge Service..."
              SimpleSC::RemoveService "clash_verge_service"
        ${ElseIf} $0 != 0
                  Push $0
                  SimpleSC::GetErrorMessage
                  Pop $0
                  MessageBox MB_OK|MB_ICONSTOP "Clash Verge Service Stop Error ($0)"
        ${EndIf}
  ${ElseIf} $1 == 0
        DetailPrint "Removing Clash Verge Service..."
        SimpleSC::RemoveService "clash_verge_service"
  ${EndIf}
    ${ElseIf} $0 != 0
          Push $0
          SimpleSC::GetErrorMessage
          Pop $0
          MessageBox MB_OK|MB_ICONSTOP "Check Service Status Error ($0)"
    ${EndIf}
  ${EndIf}
!macroend
