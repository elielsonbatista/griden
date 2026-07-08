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

/// Procura recursivamente um `GtkHeaderBar` na subárvore de `widget`.
/// A titlebar criada pelo tao no Wayland é um `EventBox` que contém o
/// `HeaderBar`, então descemos pelos containers até encontrá-lo.
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

            // No Wayland o tao desenha sua própria titlebar (um GtkHeaderBar)
            // com `decoration-layout` fixo ("menu:minimize,maximize,close"),
            // ignorando tanto o `gtk-decoration-layout` quanto o button-layout
            // do GNOME. Espelhamos `org.gnome.desktop.wm.preferences
            // button-layout` (mesmo formato lado_esquerdo:lado_direito) direto
            // no HeaderBar de cada janela. Em X11 não há HeaderBar próprio
            // (titlebar() é None) e as decorações nativas já seguem o dconf,
            // então isto vira no-op. macOS/Windows ficam intocados (cfg gate).
            #[cfg(target_os = "linux")]
            {
                use gtk::gio;
                use gtk::prelude::*;

                let layout =
                    gio::Settings::new("org.gnome.desktop.wm.preferences").string("button-layout"); // ex.: "close,minimize,maximize:"

                for (_label, window) in app.webview_windows() {
                    if let Ok(gtk_window) = window.gtk_window() {
                        if let Some(titlebar) = gtk_window.titlebar() {
                            if let Some(header) = find_header_bar(&titlebar) {
                                header.set_decoration_layout(Some(layout.as_str()));
                            }
                        }

                        // O WebKitGTK consome Ctrl+W antes de entregá-lo ao JS, então
                        // interceptamos na janela: emitimos "close-tab" ao frontend e
                        // inibimos a propagação para o webview.
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
