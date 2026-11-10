# Map engine demo

An interactive test bench for the map engine on the sample crypt: drag tokens, open doors, switch between the player and GM views, see movement ranges (dashed outlines for one, two and three Strides), routes (with terrain costs), light and vision (torches, darkvision, concealment, fading dim light, coloured light) and the fog of war, and select a creature to see the board through its eyes. The GM view adds lamp and lighting-region marks, a Lighting card to change any light's colour and intensity, and a switch for coloured light. It runs the real engine code, bundled into one page.

Build it:

```
node tools/bundle.mjs examples/demo/map-demo.html dist/map-demo.html --data map=examples/sample-pack/maps/sample-crypt --data setup=examples/demo/crypt-setup.json
```

Then open `dist/map-demo.html` in a browser. `dist/` is not committed.

A larger test bench, the **Sample Keep** (48 x 48: a keep with eight rooms and grounds outside), exercises every feature at once: every wall type, doors, double doors and a secret door, pillars, every kind of terrain, sky regions, daylight through windows, slits, the portcullis and open doors, braziers, a lantern cone, unlit torches, coloured glows and overlapping red, green and blue test lights, PCs with a torch, darkvision and low-light vision, and creatures from Tiny to Huge:

```
python3 tools/samples/sample_keep.py   # regenerate the map and keep-setup.json (only after changing the generator)
node tools/bundle.mjs examples/demo/map-demo.html dist/keep-demo.html --data map=examples/sample-pack/maps/sample-keep --data setup=examples/demo/keep-setup.json
```

The same page runs on any imported map: `--data map=<map folder>` and `--data setup=<setup file>`. The setup file (`crypt-setup.json` is the example) gives the title, the tokens and their starting squares, and the tips in the sidebar. A demo built on a private pack contains that book's map, so build it into the pack folder and keep it there.
