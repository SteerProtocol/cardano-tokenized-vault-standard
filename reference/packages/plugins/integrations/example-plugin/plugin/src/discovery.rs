//! Stateless paging of explicit collection rules for the component fixture.
//! Real adapters derive rules from protocol deployment configuration. The
//! host still validates scope and coverage and pins inputs for the whole run.

use crate::ctvs::example_plugin::discovery_types::{
    DiscoveryError, DiscoveryErrorCode, DiscoveryPageV1, ExampleDeployment,
};

const MAX_PAGE_SIZE: u32 = 256;

pub fn page(
    config: ExampleDeployment,
    cursor: Option<String>,
    page_size: u32,
) -> Result<DiscoveryPageV1, DiscoveryError> {
    if config.network.network_id > 1 {
        return Err(failure(
            DiscoveryErrorCode::InvalidNetwork,
            "network-id must be 0 or 1",
        ));
    }

    if page_size == 0 || page_size > MAX_PAGE_SIZE {
        return Err(failure(
            DiscoveryErrorCode::InvalidPageSize,
            "page-size must be between 1 and 256",
        ));
    }

    let total = config.rules.len();
    let start = cursor_offset(cursor.as_deref(), total)?;
    let end = start.saturating_add(page_size as usize).min(total);

    Ok(DiscoveryPageV1 {
        schema: "CTVS-DISCOVERY-1".into(),
        network: config.network,
        rules: config
            .rules
            .into_iter()
            .skip(start)
            .take(end - start)
            .collect(),
        next_cursor: (end < total).then(|| end.to_string()),
    })
}

fn cursor_offset(cursor: Option<&str>, total: usize) -> Result<usize, DiscoveryError> {
    let Some(raw) = cursor else {
        return Ok(0);
    };

    let canonical = !raw.is_empty()
        && raw.bytes().all(|byte| byte.is_ascii_digit())
        && (raw.len() == 1 || !raw.starts_with('0'));
    let offset = canonical.then(|| raw.parse::<usize>().ok()).flatten();

    match offset {
        Some(offset) if offset <= total => Ok(offset),
        _ => Err(failure(
            DiscoveryErrorCode::InvalidCursor,
            "cursor must be a canonical decimal offset within the configured rules",
        )),
    }
}

fn failure(code: DiscoveryErrorCode, message: &str) -> DiscoveryError {
    DiscoveryError {
        code,
        message: message.into(),
    }
}
