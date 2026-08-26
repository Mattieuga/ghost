const CLOUD_AUTH_SERVICE: &str = "com.ghost.app.cloud-auth";
const CLOUD_AUTH_KEY_PREFIX: &str = "ghost-cloud-auth-";
const MAX_SESSION_BYTES: usize = 128 * 1024;

fn validate_storage_key(key: &str) -> Result<(), String> {
    if !key.starts_with(CLOUD_AUTH_KEY_PREFIX)
        || key.len() > 160
        || !key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
    {
        return Err("Invalid Cloud authentication storage key".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn cloud_auth_storage_get(key: String) -> Result<Option<String>, String> {
    validate_storage_key(&key)?;

    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::get_generic_password;
        use security_framework_sys::base::errSecItemNotFound;

        return match get_generic_password(CLOUD_AUTH_SERVICE, &key) {
            Ok(bytes) => String::from_utf8(bytes)
                .map(Some)
                .map_err(|_| "The stored Cloud session is not valid UTF-8".to_string()),
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(error) => Err(format!("Could not read the Cloud session from Keychain: {error}")),
        };
    }

    #[cfg(not(target_os = "macos"))]
    Err("Secure Cloud session storage is not implemented on this platform".to_string())
}

#[tauri::command]
pub fn cloud_auth_storage_set(key: String, value: String) -> Result<(), String> {
    validate_storage_key(&key)?;
    if value.len() > MAX_SESSION_BYTES {
        return Err("The Cloud authentication session is unexpectedly large".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::set_generic_password;
        return set_generic_password(CLOUD_AUTH_SERVICE, &key, value.as_bytes())
            .map_err(|error| format!("Could not store the Cloud session in Keychain: {error}"));
    }

    #[cfg(not(target_os = "macos"))]
    Err("Secure Cloud session storage is not implemented on this platform".to_string())
}

#[tauri::command]
pub fn cloud_auth_storage_remove(key: String) -> Result<(), String> {
    validate_storage_key(&key)?;

    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::delete_generic_password;
        use security_framework_sys::base::errSecItemNotFound;

        return match delete_generic_password(CLOUD_AUTH_SERVICE, &key) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == errSecItemNotFound => Ok(()),
            Err(error) => Err(format!("Could not remove the Cloud session from Keychain: {error}")),
        };
    }

    #[cfg(not(target_os = "macos"))]
    Err("Secure Cloud session storage is not implemented on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_storage_key;

    #[test]
    fn accepts_only_project_scoped_cloud_auth_keys() {
        assert!(validate_storage_key("ghost-cloud-auth-project.ref-123").is_ok());
        assert!(validate_storage_key("other-app-session").is_err());
        assert!(validate_storage_key("ghost-cloud-auth-project/ref").is_err());
        assert!(validate_storage_key(&format!("ghost-cloud-auth-{}", "x".repeat(200))).is_err());
    }
}
