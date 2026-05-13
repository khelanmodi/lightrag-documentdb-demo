import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { colorForType, LEGEND } from './colors.js';

export default function GraphPanel({ graph, highlight }) {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (!graph || !svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const nodes = graph.nodes.map((n) => ({ ...n }));
    const links = graph.edges.map((e) => ({ ...e }));

    const highlightedNodeIds = new Set((highlight?.nodes || []).map((n) => n.id));
    const highlightedEdgeKeys = new Set(
      (highlight?.edges || []).map((e) => `${e.source}::${e.target}`)
    );
    const anyHighlight = highlightedNodeIds.size > 0;

    const sim = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance(90).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius(28));

    const g = svg.append('g');

    svg.call(
      d3.zoom().scaleExtent([0.25, 4]).on('zoom', (ev) => g.attr('transform', ev.transform))
    );

    const link = g
      .append('g')
      .attr('stroke', '#475569')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-width', (d) => {
        const k = `${d.source.id || d.source}::${d.target.id || d.target}`;
        return highlightedEdgeKeys.has(k) ? 2.5 : 1;
      })
      .attr('stroke-opacity', (d) => {
        if (!anyHighlight) return 0.5;
        const k = `${d.source.id || d.source}::${d.target.id || d.target}`;
        return highlightedEdgeKeys.has(k) ? 0.95 : 0.1;
      });

    link.append('title').text((d) => d.relation || '');

    const node = g
      .append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .call(
        d3
          .drag()
          .on('start', (ev, d) => {
            if (!ev.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
          .on('end', (ev, d) => {
            if (!ev.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      );

    node
      .append('circle')
      .attr('r', (d) => (highlightedNodeIds.has(d.id) ? 12 : 8))
      .attr('fill', (d) => colorForType(d.type))
      .attr('stroke', (d) => (highlightedNodeIds.has(d.id) ? '#fff' : '#0f172a'))
      .attr('stroke-width', (d) => (highlightedNodeIds.has(d.id) ? 2.5 : 1.2))
      .attr('opacity', (d) => {
        if (!anyHighlight) return 1;
        return highlightedNodeIds.has(d.id) ? 1 : 0.18;
      });

    node
      .append('text')
      .text((d) => d.label)
      .attr('x', 14)
      .attr('y', 4)
      .attr('font-size', 11)
      .attr('fill', '#e2e8f0')
      .attr('opacity', (d) => {
        if (!anyHighlight) return 0.9;
        return highlightedNodeIds.has(d.id) ? 1 : 0.25;
      });

    const tip = d3.select(tooltipRef.current);
    node
      .on('mouseover', (ev, d) => {
        tip
          .style('display', 'block')
          .style('left', ev.offsetX + 12 + 'px')
          .style('top', ev.offsetY + 12 + 'px')
          .html(
            `<div><strong>${d.label}</strong></div>` +
            `<div style="opacity:.7">type: ${d.type || 'concept'}</div>` +
            (d.description ? `<div style="margin-top:4px">${d.description}</div>` : '')
          );
      })
      .on('mousemove', (ev) => {
        tip.style('left', ev.offsetX + 12 + 'px').style('top', ev.offsetY + 12 + 'px');
      })
      .on('mouseout', () => tip.style('display', 'none'));

    sim.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => sim.stop();
  }, [graph, highlight]);

  return (
    <div className="relative h-full w-full bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
      <div className="absolute top-2 left-3 z-10 text-sm font-semibold text-slate-300">
        Knowledge Graph
        {highlight?.nodes?.length > 0 && (
          <span className="ml-2 text-xs font-normal text-emerald-400">
            {highlight.nodes.length} entities · {highlight.edges.length} edges highlighted
          </span>
        )}
      </div>
      <svg ref={svgRef} className="w-full h-full" />
      <div ref={tooltipRef} className="node-tooltip" style={{ display: 'none' }} />
      <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-2 text-[10px]">
        {LEGEND.map((l) => (
          <div key={l.type} className="flex items-center gap-1 px-2 py-1 bg-slate-800/70 rounded">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: colorForType(l.type) }}
            />
            <span className="text-slate-300">{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
