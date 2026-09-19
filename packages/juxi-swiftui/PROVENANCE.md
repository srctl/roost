# Juxi SwiftUI snapshot

Copied on 2026-09-19 from the upstream builder's `juxi/adapters/swiftui` directory,
with coordination through the Juxi Herdr task. The upstream source was not yet
committed or released. Only the library sources are included; the package manifest
omits the upstream test target because its test files were not yet available.
Roost's native regression suite verifies decoding, validation, binding, fallback,
and integration behavior against this snapshot.

Source SHA-256 values:

```text
4d7984c8cdba0db05780be19d12654fa51f3983c1a98e215f76ee7fe5d25c5e8 JSONValue.swift
36d9926cbebde9da84ee139154453b3e75bfb0c234dea63f30e388b43d247457 JuxiError.swift
8d9d53e93f8105a7ea6552c577284d9c45df4bad6eafa7afddc73e5ccd440c42 JuxiPlan.swift
b26ff096fcb087e9b95da0a3cc39bf1a63d1e7627111ddfa376f6763bd28511f JuxiPlanView.swift
bb911be051c65f0b48e0ee8c5379b31d20970ecd198984ad64f7744a3d008373 JuxiRegistry.swift
```

Replace the snapshot with a verified SwiftPM release/revision when upstream is
published. Remote SwiftPM consumption requires a repository-root Package.swift;
a nested adapter package alone is not a remote package entry point.
