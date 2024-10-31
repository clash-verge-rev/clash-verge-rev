!define ORIGINAL_PROVIDER_FILE "$TEMP\clash_verge_original_congestion_provider.txt"

!define NSIS_HOOK_POSTINSTALL "NSIS_HOOK_POSTINSTALL_"

!macro NSIS_HOOK_POSTINSTALL_
ExecWait 'netsh int tcp show global | findstr /R "^ *CongestionProvider" > "${ORIGINAL_PROVIDER_FILE}"'

FileOpen $0 "${ORIGINAL_PROVIDER_FILE}" r
FileRead $0 $1
FileClose $0

StrCpy $1 $1 "" 20
StrCmp $1 "bbr2" 0 +5
ExecWait 'netsh int tcp set supplemental template=internet congestionprovider=CUBIC'
ExecWait 'netsh int tcp set supplemental template=internetcustom congestionprovider=CUBIC'
ExecWait 'netsh int tcp set supplemental template=Compat congestionprovider=NewReno'
ExecWait 'netsh int tcp set supplemental template=Datacenter congestionprovider=CUBIC'
ExecWait 'netsh int tcp set supplemental template=Datacentercustom congestionprovider=CUBIC'
!macroend

!define NSIS_HOOK_PREUNINSTALL "NSIS_HOOK_PREUNINSTALL_"

!macro NSIS_HOOK_PREUNINSTALL_
FileOpen $0 "${ORIGINAL_PROVIDER_FILE}" r
FileRead $0 $1
FileClose $0

StrCpy $1 $1 "" 20
StrCmp $1 "bbr2" 0 +5
ExecWait 'netsh int tcp set supplemental template=internet congestionprovider=$1'
ExecWait 'netsh int tcp set supplemental template=internetcustom congestionprovider=$1'
ExecWait 'netsh int tcp set supplemental template=Compat congestionprovider=NewReno'
ExecWait 'netsh int tcp set supplemental template=Datacenter congestionprovider=$1'
ExecWait 'netsh int tcp set supplemental template=Datacentercustom congestionprovider=$1'

Delete "${ORIGINAL_PROVIDER_FILE}"
ExecWait '"$INSTDIR\uninstall-service.exe"'
!macroend
