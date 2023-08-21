# setup-sdl

This GitHub action downloads, builds and installs SDL from source. 

By caching the result, subsequent workflow runs will be fast(er).

## Usage

```yaml
name: "sdl"
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: libsdl-org/setup-sdl@main
        id: sdl
        with:
          install-linux-dependencies: true
          version: sdl2-latest
          
      - name: 'Configure and build your project'
        run: |
          cmake -S . -B build
          cmake --build build --verbose
```

## CMake

This action will build SDL using the default c/c++ toolchain, with CMake configuring the build.

An alternative build toolchain can be configured by using a [CMake toolchain file](https://cmake.org/cmake/help/latest/manual/cmake-toolchains.7.html).

## SDL versions

Using the `version` option, a SDL release can be used or the latest git tag:
- `sdl2-latest`: use the latest SDL2 release
- `sdlx.y.z`: use exactly a SDL `x.y.z` release (example: `sdl2.8.1`)
- `sdl2-head`: use the latest SDL2 development commit
- `sdl3-latest`: use the latest SDL3 release
- `sdl3-head`: use the latest SDL3 development commit
- `<git hash>`: use an exact SDL git hash (repo: https://github.com/libsdl-org/SDL.git)

## Options

See [action.yml](action.yml) for an overview of all options, and its defaults.

## FAQ

### My CMake project does not find SDL

First, make sure you're looking for SDL using `find_package`:
```cmake
# SDL2
find_package(SDL2 CONFIG REQUIRED)

# SDL3
find_package(SDL2 CONFIG REQUIRED)
```
If CMake is still not able to find SDL, the minimum required CMake version of your project is probably less than 3.12.
Since this version, CMake will also look for packages using environment variables as hints (see [CMP0074](https://cmake.org/cmake/help/latest/policy/CMP0074.html)).

When bumping the minimum CMake version is not desirable, here are 2 alternative methods (pick one!):
- Add `-DCMAKE_PREFIX_PATH=${{ steps.sdl.outputs.prefix }}` to the CMake configure command (or add SDL's path to an already-existing `-DCMAKE_PREFIX_PATH=` argument)
- Add `-DCMAKE_POLICY_DEFAULT_CMP0074=NEW` to the CMake configure command (this only works when the actual CMake version is >= 3.12).
