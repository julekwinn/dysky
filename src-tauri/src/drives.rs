//! The drives Windows shows in "This PC", with their size and free space.

use serde::Serialize;

#[derive(Serialize)]
pub struct Drive {
    path: String,
    letter: String,
    label: String,
    total: u64,
    free: u64,
    removable: bool,
}

#[cfg(windows)]
pub fn list() -> Vec<Drive> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW};
    const REMOVABLE: u32 = 2;
    const FIXED: u32 = 3;

    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .filter_map(|i| {
            let letter = format!("{}:", (b'A' + i) as char);
            let path = format!("{letter}\\");
            let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
            // Network, optical and RAM drives are left out.
            let kind = unsafe { GetDriveTypeW(wide.as_ptr()) };
            if kind != FIXED && kind != REMOVABLE {
                return None;
            }
            // An empty card reader has no size; skip it.
            let (mut total, mut free) = (0u64, 0u64);
            if unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), null_mut(), &mut total, &mut free) } == 0 {
                return None;
            }
            let mut name = [0u16; 261];
            let ok = unsafe {
                GetVolumeInformationW(
                    wide.as_ptr(),
                    name.as_mut_ptr(),
                    name.len() as u32,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    0,
                )
            } != 0;
            let len = name.iter().position(|&c| c == 0).unwrap_or(0);
            let label = match (ok && len > 0, kind == REMOVABLE) {
                (true, _) => String::from_utf16_lossy(&name[..len]),
                (false, true) => "USB Drive".into(),
                (false, false) => "Local Disk".into(),
            };
            Some(Drive { path, letter, label, total, free, removable: kind == REMOVABLE })
        })
        .collect()
}

#[cfg(not(windows))]
pub fn list() -> Vec<Drive> {
    Vec::new()
}
