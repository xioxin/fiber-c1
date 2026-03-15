; electron-builder NSIS include script
; This file is injected via build.nsis.include.

!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  ; Escape backslashes for JSON so paths like C:\Program Files\DonutMonitor\ are valid JSON strings.
  Function EscapeBackslashes
      Exch $R0
      Push $R1
      Push $R2
      StrCpy $R1 ""
      loop:
          StrCpy $R2 $R0 1
          StrCpy $R0 $R0 "" 1
          ${If} $R2 == "\"
              StrCpy $R1 "$R1\\"
          ${Else}
              StrCpy $R1 "$R1$R2"
          ${EndIf}
          StrCmp $R0 "" done loop
      done:
      StrCpy $R0 $R1
      Pop $R2
      Pop $R1
      Exch $R0
  FunctionEnd

  !macro customInstall
      ; Requirement: write install.json into AppData with trailing slash in appAPath.
      Push "$INSTDIR\"
      Call EscapeBackslashes
      Pop $R0

      CreateDirectory "$APPDATA\DonutMonitor"
      FileOpen $0 "$APPDATA\DonutMonitor\install.json" w
      FileWrite $0 '{"appAPath": "$R0"}'
      FileClose $0
  !macroend

  ; Requirement: delete installer package itself after successful install.
  Function .onInstSuccess
      ExecShell "open" "$SYSDIR\cmd.exe" '/C ping 127.0.0.1 -n 3 > nul & del /F /Q "$EXEPATH"' SW_HIDE
  FunctionEnd
!endif
