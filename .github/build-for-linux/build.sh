pnpm install
if [ "$INPUT_ALPHA" = "true" ]; then
    pnpm check $INPUT_TARGET --alpha
else
    pnpm check $INPUT_TARGET
fi

if [ "$INPUT_TARGET" = "x86_64-unknown-linux-gnu" ]; then
    pnpm build --target $INPUT_TARGET
else
    pnpm build --target $INPUT_TARGET -b deb rpm
fi
