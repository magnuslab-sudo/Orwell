; The installer doesn't ask "for everyone or just me". Owner's decision Nov 3,
; 2026: always installs per-user, in %LOCALAPPDATA%\Programs\Orwell, and
; whoever is there updates without admin.
;
; Why this is a macro and not an option in `electron-builder.yml`: with
; `oneClick: false`, electron-builder puts the install mode page WHENEVER
; `perMachine` is not `true` (`assistedInstaller.nsh`, PAGE_INSTALL_MODE).
; `allowElevation: false` only disables the "for everyone" button, and the page
; still appears. `oneClick: true` would remove the page, but also the folder
; choice, which the owner wants to keep. The loophole left is this: the
; `customInstallMode`, which the page entry function calls before drawing it.
; With one of the two `isForce...` set to "1", the page does `Abort` and
; doesn't appear.
;
; The logic, in this order:
;  - there's already an all-users install (HKLM) and no per-user one: it stays
;    where it is, in Program Files. The installer asks for UAC once and
;    overwrites it. Without this, whoever is already in Program Files would end
;    up with two copies;
;  - everything else (nothing installed, or already per-user): just for me.
;
; The two variables come from `initMultiUser` (`assistedInstaller.nsh`), which
; reads `InstallLocation` from HKLM and HKCU in `.onInit`, before any page.
; The uninstaller goes through the same macro, with the same logic.
;
; The `!echo` writes to the build log when the macro enters the page function
; (with `DEBUG=electron-builder`, which shows makensis output). It's the proof,
; in each build, that electron-builder found it: the template looks for
; `customInstallmode`, and NSIS macro names are case-insensitive. The
; `!verbose 4` is just to make `!echo` print: makensis runs at 3, which
; silences it.
!macro customInstallMode
  !verbose push 4
  !echo "Orwell: customInstallMode dentro da pagina do modo de instalacao"
  !verbose pop
  ${if} $hasPerMachineInstallation == "1"
  ${andIf} $hasPerUserInstallation == "0"
    StrCpy $isForceMachineInstall "1"
  ${else}
    StrCpy $isForceCurrentInstall "1"
  ${endIf}
!macroend

; Finish page link to Ko-fi. MUI_PAGE_FINISH (assistedInstaller.nsh) reads
; these defines; this file is included before it. Installer only: the
; uninstaller's finish page would show the link too.
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_LINK "Support Orwell on Ko-fi"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://ko-fi.com/orwell_eu"
!endif
