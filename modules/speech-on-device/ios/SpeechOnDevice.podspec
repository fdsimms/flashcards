# Says whether iOS can recognize speech in a language on the phone itself, with no connection.
Pod::Spec.new do |s|
  s.name           = 'SpeechOnDevice'
  s.version        = '1.0.0'
  s.summary        = 'Whether speech in a language is recognized on the device'
  s.description    = 'Whether speech in a language is recognized on the device'
  s.license        = 'MIT'
  s.author         = 'Franki'
  s.homepage       = 'https://github.com/fdsimms/flashcards'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,c,swift}'
end
