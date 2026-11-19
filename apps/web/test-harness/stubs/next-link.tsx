import type { AnchorHTMLAttributes, ReactNode } from "react";
import { navigate } from "./next-navigation";

export default function Link({ href, children, ...rest }: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest} onClick={(e) => {
      if (e.metaKey || e.ctrlKey || e.button !== 0) return;
      e.preventDefault();
      navigate(href);
    }}>{children}</a>
  );
}
