# Map engine demo

An interactive test bench for the map engine on the sample crypt: drag tokens, open doors, switch between the player and GM views, see movement ranges, routes and the fog of war. It runs the real engine code, bundled into one page.

Build it:

```
node tools/bundle.mjs examples/demo/map-demo.html dist/map-demo.html --data crypt=examples/sample-pack/maps/sample-crypt
```

Then open `dist/map-demo.html` in a browser. `dist/` is not committed.
