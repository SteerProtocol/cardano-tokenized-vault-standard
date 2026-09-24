-- Typography only. Keep literals exact while permitting legal line wrapping.
function Code(el)
  if FORMAT:match('latex') and #el.text > 20 and not el.text:match('%s') then
    local s=el.text:gsub('([%%#&{}_])','\\%1')
    return pandoc.RawInline('latex','\\texttt{\\seqsplit{'..s..'}}')
  end
end
function Header(el)
  if el.level == 1 and pandoc.utils.stringify(el):match('^10%. Managed NAV') then
    return {pandoc.RawBlock('latex','\\clearpage'),el}
  end
end
function CodeBlock(el)
  if FORMAT:match('latex') and el.text:match('^authenticated F_lock') then
    return pandoc.RawBlock('latex','\\par\\noindent\\begin{minipage}{\\linewidth}\n\\begin{verbatim}\n'..el.text..'\n\\end{verbatim}\n\\end{minipage}\\par')
  end
end
