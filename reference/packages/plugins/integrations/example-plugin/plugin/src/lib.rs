wit_bindgen::generate!({
    path: "wit",
    world: "plugin",
});

mod discovery;

struct ExamplePlugin;

impl Guest for ExamplePlugin {
    fn discover(
        config: ExampleDeployment,
        cursor: Option<String>,
        page_size: u32,
    ) -> Result<DiscoveryPageV1, DiscoveryError> {
        discovery::page(config, cursor, page_size)
    }

    fn fetch(url: String) -> Result<ctvs::example_plugin::http::Response, String> {
        ctvs::example_plugin::http::get(&url)
    }
}

export!(ExamplePlugin);
