# Reads an audio file into plain samples, for the pitch line in Record yourself.
Pod::Spec.new do |s|
  s.name           = 'AudioSamples'
  s.version        = '1.0.0'
  s.summary        = 'An audio file as mono samples'
  s.description    = 'An audio file decoded to mono Float32 samples at a given rate'
  s.license        = 'MIT'
  s.author         = 'Franki'
  s.homepage       = 'https://github.com/fdsimms/flashcards'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,c,swift}'
end
