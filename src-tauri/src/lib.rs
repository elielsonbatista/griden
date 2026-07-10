mod commands;
mod connection;
mod drivers;
mod edits;
mod error;
mod introspection;
mod models;
mod tunnel;

use connection::ConnectionManager;
use tauri::Manager;

/// Recursively searches for a `GtkHeaderBar` in the subtree of `widget`.
/// The titlebar created by tao on Wayland is an `EventBox` that contains the
/// `HeaderBar`, so we descend through the containers until we find it.
#[cfg(target_os = "linux")]
fn find_header_bar(widget: &gtk::Widget) -> Option<gtk::HeaderBar> {
    use gtk::prelude::*;

    if let Some(header) = widget.downcast_ref::<gtk::HeaderBar>() {
        return Some(header.clone());
    }
    if let Some(container) = widget.downcast_ref::<gtk::Container>() {
        for child in container.children() {
            if let Some(found) = find_header_bar(&child) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let manager = ConnectionManager::new(config_dir)?;
            app.manage(manager);

            // On Wayland, tao draws its own titlebar (a GtkHeaderBar)
            // with a fixed `decoration-layout` ("menu:minimize,maximize,close"),
            // ignoring both `gtk-decoration-layout` and GNOME's button-layout.
            // We mirror `org.gnome.desktop.wm.preferences button-layout` (same
            // left_side:right_side format) directly onto each window's
            // HeaderBar. On X11 there is no dedicated HeaderBar (titlebar() is
            // None) and native decorations already follow dconf, so this becomes
            // a no-op. macOS/Windows are left untouched (cfg gate).
            #[cfg(target_os = "linux")]
            {
                use gtk::gio;
                use gtk::prelude::*;

                let layout =
                    gio::Settings::new("org.gnome.desktop.wm.preferences").string("button-layout"); // e.g. "close,minimize,maximize:"

                for (_label, window) in app.webview_windows() {
                    if let Ok(gtk_window) = window.gtk_window() {
                        if let Some(titlebar) = gtk_window.titlebar() {
                            if let Some(header) = find_header_bar(&titlebar) {
                                header.set_decoration_layout(Some(layout.as_str()));
                            }
                        }

                        // WebKitGTK consumes Ctrl+W before delivering it to JS, so
                        // we intercept it at the window: we emit "close-tab" to the
                        // frontend and stop propagation to the webview.
                        let emit_to = window.clone();
                        gtk_window.connect_key_press_event(move |_w, ev| {
                            use gtk::gdk;
                            let ctrl = ev.state().contains(gdk::ModifierType::CONTROL_MASK);
                            let key = ev.keyval();
                            if ctrl
                                && (key == gdk::keys::constants::w
                                    || key == gdk::keys::constants::W)
                            {
                                use tauri::Emitter;
                                let _ = emit_to.emit("close-tab", ());
                                return gtk::glib::Propagation::Stop;
                            }
                            gtk::glib::Propagation::Proceed
                        });
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::is_connected,
            commands::run_query,
            commands::get_schemas,
            commands::get_tables,
            commands::get_columns,
            commands::get_schema_columns,
            commands::get_foreign_keys,
            commands::apply_edits,
            commands::save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
