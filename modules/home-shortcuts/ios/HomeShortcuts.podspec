# The Home Screen quick actions (long-press the app icon): Add words, and Add to the last deck.
Pod::Spec.new do |s|
  s.name           = 'HomeShortcuts'
  s.version        = '1.0.0'
  s.summary        = 'Sets the Home Screen quick actions and passes a tapped one to JS'
  s.description    = 'Sets the Home Screen quick actions and passes a tapped one to JS'
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
