#!/usr/bin/env python3
"""Regenerate the dependency-free Xcode project and pixel artwork from Roost SVGs."""
import hashlib
import json
import pathlib
import re
import struct
import xml.etree.ElementTree as ET
import zlib

root = pathlib.Path(__file__).resolve().parent
objects = {}


def oid(name):
    return hashlib.sha1(name.encode()).hexdigest()[:24].upper()


def obj(key_name, isa, **fields):
    key = oid(key_name)
    objects[key] = dict(isa=isa, **fields)
    return key


characters = {}
for path in (root.parent / "web/src/assets").glob("*.svg"):
    if path.stem.startswith("roost"):
        continue
    pixels = []
    for node in ET.parse(path).getroot():
        if node.tag.endswith("rect"):
            pixels.append(
                {k: float(node.attrib.get(k, 1)) for k in ("x", "y", "width", "height")}
                | {"fill": node.attrib["fill"]}
            )
    characters[path.stem] = pixels
(root / "Roost/Resources/Characters.json").write_text(
    json.dumps(characters, indent=2) + "\n"
)
# Bundle the exact semantic palettes used by the web app. Fail on unsupported
# source syntax so regeneration cannot silently ship a partial or stale palette.
theme_source = (root.parent / "web/src/features/settings/themes.ts").read_text()
theme_match = re.search(
    r"export const themePalettes = (\{.*?\}) as const;", theme_source, re.S
)
if not theme_match:
    raise ValueError("Could not find the web theme palettes")
theme_json = re.sub(r"(?m)^(\s*)([A-Za-z][A-Za-z0-9]*):", r'\1"\2":', theme_match[1])
theme_json = re.sub(r",(\s*[}\]])", r"\1", theme_json)
themes = json.loads(theme_json)
for variants in themes.values():
    for mode in ("light", "dark"):
        if len(variants[mode]) != 13 or not all(
            re.fullmatch(r"#[A-Fa-f0-9]{6}", value) for value in variants[mode].values()
        ):
            raise ValueError("Invalid semantic theme palette")
(root / "Roost/Resources/Themes.json").write_text(json.dumps(themes, indent=2) + "\n")

# Crisp source artwork, enlarged without interpolation for the home-screen icon.
size = 1024
pixels = bytearray(bytes((242, 242, 233)) * size * size)
for p in characters["moss"]:
    color = bytes.fromhex(p["fill"][1:])
    for y in range(int(p["y"] * 48 + 128), int((p["y"] + p["height"]) * 48 + 128)):
        for x in range(int(p["x"] * 48 + 128), int((p["x"] + p["width"]) * 48 + 128)):
            pixels[(y * size + x) * 3 : (y * size + x) * 3 + 3] = color


def chunk(kind, data):
    return (
        struct.pack("!I", len(data))
        + kind
        + data
        + struct.pack("!I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack("!2I5B", size, size, 8, 2, 0, 0, 0))
    + chunk(
        b"IDAT",
        zlib.compress(
            b"".join(
                b"\0" + pixels[y * size * 3 : (y + 1) * size * 3] for y in range(size)
            )
        ),
    )
    + chunk(b"IEND", b"")
)
assets = root / "Roost/Resources/Assets.xcassets"
(assets / "AppIcon.appiconset").mkdir(parents=True, exist_ok=True)
(assets / "Contents.json").write_text(
    json.dumps({"info": {"author": "xcode", "version": 1}}, indent=2) + "\n"
)
(assets / "AppIcon.appiconset/Icon.png").write_bytes(png)
(assets / "AppIcon.appiconset/Contents.json").write_text(
    json.dumps(
        {
            "images": [
                {
                    "filename": "Icon.png",
                    "idiom": "universal",
                    "platform": "ios",
                    "size": "1024x1024",
                }
            ],
            "info": {"author": "xcode", "version": 1},
        },
        indent=2,
    )
    + "\n"
)
products = []
groups = []
targets = []
for name, kind in [
    ("Roost", "application"),
    ("RoostTests", "bundle.unit-test"),
    ("RoostUITests", "bundle.ui-testing"),
]:
    refs = []
    builds = []
    resources = []
    for path in sorted((root / name).glob("*.swift")):
        ref = obj(
            str(path.relative_to(root)),
            "PBXFileReference",
            lastKnownFileType="sourcecode.swift",
            path=path.name,
            sourceTree="<group>",
        )
        refs.append(ref)
        builds.append(
            obj(str(path.relative_to(root)) + "-build", "PBXBuildFile", fileRef=ref)
        )
    if name == "Roost":
        for file, ft in [
            ("Characters.json", "text.json"),
            ("Themes.json", "text.json"),
            ("Assets.xcassets", "folder.assetcatalog"),
            ("PrivacyInfo.xcprivacy", "text.xml"),
        ]:
            ref = obj(
                file,
                "PBXFileReference",
                lastKnownFileType=ft,
                path="Resources/" + file,
                sourceTree="<group>",
            )
            refs.append(ref)
            resources.append(obj(file + "-build", "PBXBuildFile", fileRef=ref))
    groups.append(
        obj(name + "-group", "PBXGroup", children=refs, path=name, sourceTree="<group>")
    )
    product = obj(
        name + "-product",
        "PBXFileReference",
        explicitFileType=(
            "wrapper.application" if name == "Roost" else "wrapper.cfbundle"
        ),
        path=name + (".app" if name == "Roost" else ".xctest"),
        sourceTree="BUILT_PRODUCTS_DIR",
    )
    products.append(product)
    phases = [
        obj(
            name + "-sources",
            "PBXSourcesBuildPhase",
            buildActionMask=2147483647,
            files=builds,
            runOnlyForDeploymentPostprocessing=0,
        ),
        obj(
            name + "-frameworks",
            "PBXFrameworksBuildPhase",
            buildActionMask=2147483647,
            files=[],
            runOnlyForDeploymentPostprocessing=0,
        ),
        obj(
            name + "-resources",
            "PBXResourcesBuildPhase",
            buildActionMask=2147483647,
            files=resources,
            runOnlyForDeploymentPostprocessing=0,
        ),
    ]
    configs = []
    for mode in ("Debug", "Release"):
        settings = dict(
            PRODUCT_BUNDLE_IDENTIFIER="dev.roost.iphone"
            + ("" if name == "Roost" else "." + name),
            PRODUCT_NAME="$(TARGET_NAME)",
            SWIFT_VERSION="5.0",
            GENERATE_INFOPLIST_FILE="YES",
            CODE_SIGN_STYLE="Automatic",
            TARGETED_DEVICE_FAMILY="1,2",
            IPHONEOS_DEPLOYMENT_TARGET="17.0",
            SUPPORTED_PLATFORMS="iphoneos iphonesimulator",
            SDKROOT="iphoneos",
            SWIFT_EMIT_LOC_STRINGS="YES",
            SWIFT_ACTIVE_COMPILATION_CONDITIONS="DEBUG" if mode == "Debug" else "",
            SWIFT_OPTIMIZATION_LEVEL="-Onone" if mode == "Debug" else "-O",
        )
        if name == "Roost":
            settings.update(
                INFOPLIST_KEY_CFBundleDisplayName="Roost",
                INFOPLIST_KEY_UIApplicationSceneManifest_Generation="YES",
                INFOPLIST_KEY_UILaunchScreen_Generation="YES",
                INFOPLIST_KEY_UISupportedInterfaceOrientations="UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight",
                INFOPLIST_KEY_NSLocalNetworkUsageDescription="Connect to your Roost server on your local network.",
                INFOPLIST_KEY_NSAppTransportSecurity_NSAllowsLocalNetworking="YES",
                ASSETCATALOG_COMPILER_APPICON_NAME="AppIcon",
                MARKETING_VERSION="0.1.0",
                CURRENT_PROJECT_VERSION="1",
            )
        elif name == "RoostTests":
            settings.update(
                TEST_HOST="$(BUILT_PRODUCTS_DIR)/Roost.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Roost",
                BUNDLE_LOADER="$(TEST_HOST)",
            )
        else:
            settings.update(TEST_TARGET_NAME="Roost")
        configs.append(
            obj(name + mode, "XCBuildConfiguration", name=mode, buildSettings=settings)
        )
    config = obj(
        name + "configs",
        "XCConfigurationList",
        buildConfigurations=configs,
        defaultConfigurationIsVisible=0,
        defaultConfigurationName="Release",
    )
    deps = []
    if name != "Roost":
        proxy = obj(
            name + "proxy",
            "PBXContainerItemProxy",
            containerPortal=oid("project"),
            proxyType=1,
            remoteGlobalIDString=oid("Roost-target"),
            remoteInfo="Roost",
        )
        deps = [
            obj(
                name + "dependency",
                "PBXTargetDependency",
                target=oid("Roost-target"),
                targetProxy=proxy,
            )
        ]
    targets.append(
        obj(
            name + "-target",
            "PBXNativeTarget",
            buildConfigurationList=config,
            buildPhases=phases,
            buildRules=[],
            dependencies=deps,
            name=name,
            productName=name,
            productReference=product,
            productType="com.apple.product-type." + kind,
        )
    )
productsGroup = obj(
    "products", "PBXGroup", children=products, name="Products", sourceTree="<group>"
)
main = obj("main", "PBXGroup", children=groups + [productsGroup], sourceTree="<group>")
configs = [
    obj(
        "project" + mode,
        "XCBuildConfiguration",
        name=mode,
        buildSettings={
            "CLANG_ENABLE_MODULES": "YES",
            "SWIFT_VERSION": "5.0",
            "IPHONEOS_DEPLOYMENT_TARGET": "17.0",
            "SDKROOT": "iphoneos",
            "ENABLE_TESTABILITY": "YES" if mode == "Debug" else "NO",
            "DEBUG_INFORMATION_FORMAT": "dwarf",
            "GCC_PREPROCESSOR_DEFINITIONS": (
                ["$(inherited)", "DEBUG=1"] if mode == "Debug" else ["$(inherited)"]
            ),
        },
    )
    for mode in ("Debug", "Release")
]
config = obj(
    "projectconfigs",
    "XCConfigurationList",
    buildConfigurations=configs,
    defaultConfigurationIsVisible=0,
    defaultConfigurationName="Release",
)
obj(
    "project",
    "PBXProject",
    attributes={"LastUpgradeCheck": "1640"},
    buildConfigurationList=config,
    compatibilityVersion="Xcode 14.0",
    developmentRegion="en",
    hasScannedForEncodings=0,
    knownRegions=["en", "Base"],
    mainGroup=main,
    productRefGroup=productsGroup,
    projectDirPath="",
    projectRoot="",
    targets=targets,
)


def serialize(value):
    if isinstance(value, dict):
        return (
            "{\n"
            + "".join(
                json.dumps(k) + " = " + serialize(v) + ";\n" for k, v in value.items()
            )
            + "}"
        )
    if isinstance(value, list):
        return "(" + ",".join(serialize(v) for v in value) + ")"
    return json.dumps(value)


(root / "Roost.xcodeproj/project.pbxproj").write_text(
    "// !$*UTF8*$!\n"
    + serialize(
        {
            "archiveVersion": 1,
            "classes": {},
            "objectVersion": 56,
            "objects": objects,
            "rootObject": oid("project"),
        }
    )
    + "\n"
)


def ref(name):
    return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{oid(name+"-target")}" BuildableName="{name}.{"app" if name=="Roost" else "xctest"}" BlueprintName="{name}" ReferencedContainer="container:Roost.xcodeproj"/>'


scheme = f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1640" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref('Roost')}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{ref('RoostTests')}</TestableReference><TestableReference skipped="NO">{ref('RoostUITests')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref('Roost')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref('Roost')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>"""
(root / "Roost.xcodeproj/xcshareddata/xcschemes/Roost.xcscheme").write_text(scheme)
