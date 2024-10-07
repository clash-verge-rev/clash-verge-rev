export const TailwindIndicator = () => {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-2 right-2 z-50 flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 p-1 font-mono text-xs text-white">
      <div className="block sm:hidden">xs</div>
      <div className="2xl:hidden hidden sm:block md:hidden lg:hidden xl:hidden">
        sm
      </div>
      <div className="2xl:hidden hidden md:block lg:hidden xl:hidden">md</div>
      <div className="2xl:hidden hidden lg:block xl:hidden">lg</div>
      <div className="2xl:hidden hidden xl:block">xl</div>
      <div className="2xl:block hidden">2xl</div>
    </div>
  );
};
