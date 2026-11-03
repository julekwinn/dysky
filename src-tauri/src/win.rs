//! The few Windows calls Dysky needs beyond the standard library, each with a plain stand-in on other
//! systems so the tests run anywhere.

use std::fs::Metadata;
use std::path::Path;

/// Attribute bits from `WIN32_FIND_DATA` that the scan looks at.
pub mod attr {
    pub const HIDDEN: u32 = 0x2;
    pub const SYSTEM: u32 = 0x4;
    pub const SPARSE: u32 = 0x200;
    pub const REPARSE_POINT: u32 = 0x400;
    pub const COMPRESSED: u32 = 0x800;
    pub const OFFLINE: u32 = 0x1000;
    pub const RECALL_ON_OPEN: u32 = 0x4_0000;
    pub const RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
}

#[cfg(windows)]
pub fn attributes(md: &Metadata) -> u32 {
    use std::os::windows::fs::MetadataExt;
    md.file_attributes()
}

#[cfg(not(windows))]
pub fn attributes(_: &Metadata) -> u32 {
    0
}

/// How much of the disk a file takes, which is what a disk viewer should add up:
/// online-only cloud files (OneDrive and the like) take nothing, compressed, sparse and
/// CompactOS files take what is actually stored, everything else takes its length.
pub fn size_on_disk(path: &Path, md: &Metadata, attrs: u32) -> u64 {
    if attrs & (attr::RECALL_ON_DATA_ACCESS | attr::RECALL_ON_OPEN | attr::OFFLINE) != 0 {
        return 0;
    }
    if attrs & (attr::COMPRESSED | attr::SPARSE | attr::REPARSE_POINT) != 0 {
        if let Some(size) = compressed_size(path) {
            return size;
        }
    }
    md.len()
}

#[cfg(windows)]
fn compressed_size(path: &Path) -> Option<u64> {
    use windows_sys::Win32::Storage::FileSystem::{GetCompressedFileSizeW, INVALID_FILE_SIZE};
    let wide = wide(path.as_os_str());
    let mut high = 0u32;
    let low = unsafe { GetCompressedFileSizeW(wide.as_ptr(), &mut high) };
    (low != INVALID_FILE_SIZE || high != 0).then(|| (u64::from(high) << 32) | u64::from(low))
}

#[cfg(not(windows))]
fn compressed_size(_: &Path) -> Option<u64> {
    None
}

/// Whether a folder tells names apart by case (WSL and developer folders can). Only asked when a
/// folder lists two names that differ only by case, which in an ordinary folder are one and the same.
#[cfg(windows)]
pub fn case_sensitive(dir: &Path) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FileCaseSensitiveInfo, GetFileInformationByHandleEx, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    #[repr(C)]
    struct CaseInfo {
        flags: u32,
    }
    const CASE_SENSITIVE_DIR: u32 = 1;
    let wide = wide(dir.as_os_str());
    unsafe {
        let share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
        let h = CreateFileW(
            wide.as_ptr(),
            FILE_READ_ATTRIBUTES,
            share,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        );
        if h == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut info = CaseInfo { flags: 0 };
        let ok =
            GetFileInformationByHandleEx(h, FileCaseSensitiveInfo, &mut info as *mut CaseInfo as *mut _, size_of::<CaseInfo>() as u32) != 0;
        CloseHandle(h);
        ok && info.flags & CASE_SENSITIVE_DIR != 0
    }
}

#[cfg(not(windows))]
pub fn case_sensitive(_: &Path) -> bool {
    true
}

/// Opens File Explorer with the item selected, reusing an Explorer window that already shows its folder.
#[cfg(windows)]
pub fn reveal(path: &Path) -> Result<(), String> {
    use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows_sys::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};
    let wide = wide(path.as_os_str());
    // The shell wants a COM apartment of its own, so it gets a short-lived thread.
    let shown = std::thread::spawn(move || unsafe {
        CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        let item = ILCreateFromPathW(wide.as_ptr());
        if item.is_null() {
            return false;
        }
        let ok = SHOpenFolderAndSelectItems(item, 0, std::ptr::null(), 0) >= 0;
        ILFree(item);
        ok
    })
    .join()
    .unwrap_or(false);
    if shown {
        return Ok(());
    }
    // The shell could not take it (a path too long for it, say): let Explorer try on its own.
    use std::os::windows::process::CommandExt;
    std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn reveal(_: &Path) -> Result<(), String> {
    Err("Showing files is only supported on Windows".into())
}

/// Whether this is Windows 11 or later, where the window can have the Mica backdrop.
#[cfg(windows)]
pub fn has_mica() -> bool {
    use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
    let mut v: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    v.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;
    let status = unsafe { RtlGetVersion(&mut v) };
    status == 0 && v.dwBuildNumber >= 22000
}

#[cfg(not(windows))]
pub fn has_mica() -> bool {
    false
}

/// No "There is no disk in the drive" dialogs while drives and card readers are listed.
#[cfg(windows)]
pub fn quiet_drive_errors() {
    use windows_sys::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_FAILCRITICALERRORS};
    unsafe { SetErrorMode(SEM_FAILCRITICALERRORS) };
}

#[cfg(not(windows))]
pub fn quiet_drive_errors() {}

/// A plain error dialog, for when the window itself cannot be relied on.
#[cfg(windows)]
pub fn alert(title: &str, text: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let (title, text) = (wide(title.as_ref()), wide(text.as_ref()));
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR) };
}

#[cfg(not(windows))]
pub fn alert(title: &str, text: &str) {
    eprintln!("{title}: {text}");
}

#[cfg(windows)]
fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.encode_wide().chain(Some(0)).collect()
}
