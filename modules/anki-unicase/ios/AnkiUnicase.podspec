# Registers Anki's `unicase` collation with expo-sqlite's SQLite, so Franki can write Anki's
# decks, deck options, note types and tags tables (see unicase_register.c).
Pod::Spec.new do |s|
  s.name           = 'AnkiUnicase'
  s.version        = '1.0.0'
  s.summary        = "Anki's unicase collation for expo-sqlite"
  s.description    = "Anki's unicase collation for expo-sqlite"
  s.license        = 'MIT'
  s.author         = 'Franki'
  s.homepage       = 'https://github.com/fdsimms/flashcards'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # expo-sqlite's own SQLite build (its functions are named exsqlite3_*), which this registers with.
  s.dependency 'ExpoSQLite'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,c,swift}'
end
