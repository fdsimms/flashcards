# The Live Activity for an audio lesson or a Read & Listen text that is playing.
Pod::Spec.new do |s|
  s.name           = 'ListeningActivity'
  s.version        = '1.0.0'
  s.summary        = 'Lock screen and Dynamic Island controls for listening'
  s.description    = 'Starts and updates the listening Live Activity and reports taps on its buttons'
  s.license        = 'MIT'
  s.author         = 'Franki'
  s.homepage       = 'https://github.com/fdsimms/flashcards'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # ActivityKit's calls are all behind #available(iOS 17.0, *), and the floor above is lower, so it is
  # weak-linked: a hard link would stop the app launching on an iPhone without it.
  s.weak_frameworks = 'ActivityKit'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,c,swift}'
end
