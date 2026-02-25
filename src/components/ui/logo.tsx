import Image from 'next/image'

interface LogoProps {
  width?: number
  height?: number
  className?: string
}

export function Logo({ width = 200, height = 60, className = '' }: LogoProps) {
  return (
    <Image
      src="/logo-valarg.png"
      alt="VAL ARG S.R.L."
      width={width}
      height={height}
      className={className}
      priority
    />
  )
}
