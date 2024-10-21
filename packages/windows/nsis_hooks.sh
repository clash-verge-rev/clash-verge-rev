!define NSIS_HOOK_PREUNINSTALL "NSIS_HOOK_PREUNINSTALL_"

!macro NSIS_HOOK_PREUNINSTALL_
ExecWait '"$INSTDIR\uninstall-service.exe"'
!macroend
