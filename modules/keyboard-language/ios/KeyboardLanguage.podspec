# Opens a text field on the keyboard for a language (Russian, Thai...) when the person has that
# keyboard enabled, so a typed answer doesn't start on the English one.
Pod::Spec.new do |s|
  s.name           = 'KeyboardLanguage'
  s.version        = '1.0.0'
  s.summary        = 'Picks the keyboard language for the focused text field'
  s.description    = 'Picks the keyboard language for the focused text field'
  s.license        = 'MIT'
  s.author         = 'Franki'
  s.homepage       = 'https://github.com/fdsimms/flashcards'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,c,swift}'
end
