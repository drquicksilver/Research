#!/usr/bin/env ruby
# frozen_string_literal: true

require "date"
require "yaml"

abort "Usage: #{$PROGRAM_NAME} PATH_TO_REPOSITORY" unless ARGV.length == 1

transcripts = Dir.glob(File.join(ARGV.fetch(0), "episodes", "*", "transcript.md")).sort
abort "No episode transcripts found" if transcripts.empty?

episodes = transcripts.map do |path|
  parts = File.read(path, encoding: "UTF-8").split("---", 3)
  frontmatter = parts.fetch(1)
  metadata = YAML.safe_load(frontmatter, permitted_classes: [Date], aliases: true)
  title = metadata["title"] || parts.fetch(2)[/^# (.+)$/, 1]

  {
    guest: metadata.fetch("guest").sub(/ \d+\.0\z/, ""),
    title: title || "(untitled episode)",
    date: metadata["publish_date"],
    # A blank ID cannot establish that two records are the same episode.
    identity: metadata["video_id"].to_s.empty? ? path : metadata["video_id"],
    path: path
  }
end

episodes
  .group_by { |episode| episode.fetch(:guest) }
  .transform_values { |items| items.uniq { |episode| episode.fetch(:identity) } }
  .select { |_guest, items| items.length > 1 }
  .sort_by(&:first)
  .each do |guest, items|
    puts "## #{guest} (#{items.length} episodes)"
    items.sort_by { |episode| episode.fetch(:date).to_s }.each do |episode|
      puts "- #{episode.fetch(:date)} — #{episode.fetch(:title)}"
    end
    puts
  end
