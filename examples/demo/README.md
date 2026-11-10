# Map engine demo

An interactive test bench for the map engine on the sample crypt: drag tokens, open doors, switch between the player and GM views, see movement ranges, routes (with terrain costs), light and vision (torches, darkvision, concealment) and the fog of war. It runs the real engine code, bundled into one page.

Build it:

```
node tools/bundle.mjs examples/demo/map-demo.html dist/map-demo.html --data map=examples/sample-pack/maps/sample-crypt --data setup=examples/demo/crypt-setup.json
```

Then open `dist/map-demo.html` in a browser. `dist/` is not committed.

The same page runs on any imported map: `--data map=<map folder>` and `--data setup=<setup file>`. The setup file (`crypt-setup.json` is the example) gives the title, the tokens and their starting squares, and the tips in the sidebar. A demo built on a private pack contains that book's map, so build it into the pack folder and keep it there.
