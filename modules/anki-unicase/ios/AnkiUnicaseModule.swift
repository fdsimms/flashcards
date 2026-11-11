import ExpoModulesCore

/// Gives every SQLite connection the app opens Anki's `unicase` collation (unicase_register.c).
/// Call `register` before opening any database: connections opened earlier don't get it.
public class AnkiUnicaseModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AnkiUnicase")

    Function("register") { () -> Bool in
      return anki_unicase_register() == 0
    }
  }
}
