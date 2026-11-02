use std::io::{self, Read};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;

use anyhow::Result;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use wasmtime::component::{Component, Linker, ResourceTable};
use wasmtime::{Config, Engine, Store};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};

wasmtime::component::bindgen!({
    path: "../../plugin/wit",
    world: "plugin",
    imports: { default: async },
    exports: { default: async },
    // JSON belongs to this test runner's stdin/stdout transport, not the WIT ABI.
    additional_derives: [serde::Serialize, serde::Deserialize],
});

struct Host {
    wasi: WasiCtx,
    table: ResourceTable,
    http: reqwest::Client,
}

// The shared discovery interface contains types only, with no host functions.
impl ctvs::example_plugin::discovery_types::Host for Host {}

impl WasiView for Host {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl ctvs::example_plugin::http::Host for Host {
    async fn get(&mut self, url: String) -> Result<ctvs::example_plugin::http::Response, String> {
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| "fetch-failed")?;
        let status = response.status().as_u16();
        let body = response.text().await.map_err(|_| "fetch-failed")?;

        Ok(ctvs::example_plugin::http::Response { status, body })
    }
}

#[derive(Deserialize)]
struct Input {
    component: String,
    discoveries: Vec<DiscoveryCall>,
    urls: Vec<String>,
}

#[derive(Deserialize)]
struct DiscoveryCall {
    config: ctvs::example_plugin::discovery_types::ExampleDeployment,
    cursor: Option<String>,
    page_size: u32,
}

async fn fetch_all(
    plugin: &Plugin,
    store: &mut Store<Host>,
    urls: Vec<String>,
) -> Result<(Vec<serde_json::Value>, usize)> {
    let ticks = Arc::new(AtomicUsize::new(0));
    let heartbeat_ticks = ticks.clone();
    let heartbeat = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(2)).await;
            heartbeat_ticks.fetch_add(1, Ordering::Relaxed);
        }
    });
    let result = async {
        let mut fetches = Vec::new();
        for url in urls {
            let result = match plugin.call_fetch(&mut *store, &url).await? {
                Ok(response) => json!({"ok": {"status": response.status, "body": response.body}}),
                Err(error) => json!({"error": error}),
            };
            fetches.push(result);
        }
        Ok::<_, anyhow::Error>(fetches)
    }
    .await;
    heartbeat.abort();

    Ok((result?, ticks.load(Ordering::Relaxed)))
}

async fn run(input: Input) -> Result<serde_json::Value> {
    let bytes = std::fs::read(input.component)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let mut config = Config::new();
    config.async_support(true);
    let engine = Engine::new(&config)?;
    let component = Component::new(&engine, bytes)?;
    let mut linker = Linker::new(&engine);
    wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
    Plugin::add_to_linker::<_, wasmtime::component::HasSelf<_>>(&mut linker, |host| host)?;
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .build()?;
    let mut store = Store::new(
        &engine,
        Host {
            wasi: WasiCtxBuilder::new().build(),
            table: ResourceTable::new(),
            http,
        },
    );
    let plugin = Plugin::instantiate_async(&mut store, &component, &linker).await?;
    let mut discoveries = Vec::new();

    for call in input.discoveries {
        let result = plugin
            .call_discover(
                &mut store,
                &call.config,
                call.cursor.as_deref(),
                call.page_size,
            )
            .await?;
        discoveries.push(match result {
            Ok(page) => json!({"ok": page}),
            Err(error) => json!({"error": error}),
        });
    }

    let (fetches, heartbeat_ticks) = fetch_all(&plugin, &mut store, input.urls).await?;

    Ok(json!({
        "componentSha256": hash,
        "discoveries": discoveries,
        "fetches": fetches,
        "heartbeatTicks": heartbeat_ticks,
    }))
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let mut buffer = String::new();
    io::stdin().read_to_string(&mut buffer)?;
    let input: Input = serde_json::from_str(&buffer)?;
    let output = run(input).await?;
    println!("{output}");

    Ok(())
}
