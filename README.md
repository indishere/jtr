# java-to-rust-converter (`jtr`)

A project-wide Java/Kotlin → Rust conversion CLI.

> **Status: MVP / best-effort transpiler.** Java/Kotlin and Rust have very different object, inheritance, nullability, exception, concurrency, ownership, and runtime models. `jtr` automates the mechanical conversion and creates a Rust crate plus a review report, but it cannot guarantee semantic equivalence for arbitrary JVM code.

## Install

```bash
npm install -g .
```

Requires Node.js 20+.

## Usage

```bash
jtr convert --java --out-folder ./rust-out ./my-java-project
jtr convert --kotlin --out-folder ./rust-out ./my-kotlin-project
```

The input path is optional and defaults to the current directory:

```bash
jtr convert --java --out-folder ./rust-out
```

Equivalent explicit language syntax is also supported:

```bash
jtr convert --lang java --out-folder ./rust-out ./project
```

### Options

```text
--java                 Convert .java files
--kotlin               Convert .kt files
--lang <java|kotlin>   Explicit language selector
--out-folder <folder>  Required output Rust crate
--crate-name <name>    Cargo crate name
--force                Allow writing into a non-empty output directory
--dry-run              Scan/convert without writing files
```

## What it does

- Recursively scans an entire source tree.
- Understands common Maven/Gradle source roots such as `src/main/java` and `src/main/kotlin`.
- Preserves package-like folder structure as Rust modules.
- Generates `Cargo.toml`, `src/lib.rs`, nested `mod.rs` files, and `.rs` files.
- Converts common classes/data classes into structs and `impl` blocks.
- Converts common methods, constructors, primitive types, arrays, `List`/`Map`-style generics, basic variable declarations, `return`, `this`, `new`, `println`, `null`, `.length`, and `.size()` patterns.
- Converts Java interfaces / Kotlin interfaces to Rust traits.
- Converts simple Java enums.
- Writes `jtr-report.json` with per-file warnings for constructs requiring manual review.

## Output example

```text
rust-out/
├── Cargo.toml
├── jtr-report.json
└── src/
    ├── lib.rs
    └── com/
        ├── mod.rs
        └── example/
            ├── mod.rs
            └── greeter.rs
```

## Important limitations

A fully automatic, behavior-identical JVM → Rust converter is not generally possible without runtime emulation or extensive whole-program analysis. Current MVP limitations include inheritance, reflection, annotations, JVM-specific libraries, checked exceptions, coroutines, advanced generics, nested/anonymous classes, complex lambdas, overload resolution, and precise Rust ownership/borrowing inference. These are reported where detected or left for manual review.

The intended workflow is **convert → run `cargo check` → review `jtr-report.json` → fix semantic/ownership issues**.
