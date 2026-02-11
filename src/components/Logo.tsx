import unifleetLogo from "@/assets/unifleet_logo.png";
import unifleetLogoDark from "@/assets/unifleet_logo_dark.png";
import { useTheme } from "@/context/ThemeProvider";

export function Logo() {
    const { resolved } = useTheme();
    const src = resolved === 'dark' ? unifleetLogoDark : unifleetLogo;

    return (
        <div className="flex items-center ml-[-65px] mt-[13px] select-none">
            <img
                src={src}
                alt="UNIFLEET"
                className="h-[170px] w-auto object-contain"
            />
        </div>
    )
}


