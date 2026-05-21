#!/usr/bin/env python
"""
Context Chunking System for Token Efficiency

This module implements progressive context loading to reduce token usage
by providing only the necessary context for each task stage.
"""

from typing import Dict, Any, List, Optional
from pathlib import Path
import json


class ContextChunker:
    """
    Manages progressive context loading for different task stages.
    Reduces token usage by providing only necessary context per agent.
    """
    
    def __init__(self, full_context: Dict[str, Any]):
        """
        Initialize with full context data.
        
        Args:
            full_context: Complete context dictionary with all available data
        """
        self.full_context = full_context
        self.context_cache = {}
        
    def get_minimal_context(self, agent_role: str, task_stage: str) -> Dict[str, Any]:
        """
        Get minimal context for specific agent and task stage.
        
        Args:
            agent_role: The agent's role (e.g., 'brand_strategist', 'seo_specialist')
            task_stage: The current task stage (e.g., 'strategy', 'products', 'seo', 'content')
            
        Returns:
            Dict containing only the necessary context for this agent/task
        """
        cache_key = f"{agent_role}_{task_stage}"
        
        if cache_key in self.context_cache:
            return self.context_cache[cache_key]
        
        # Base context that all agents need
        base_context = {
            'brand': self.full_context.get('brand', ''),
            'voice': self.full_context.get('voice', ''),
            'theme': self.full_context.get('theme', ''),
            'name': self.full_context.get('name', ''),
            'preferred_language': self.full_context.get('preferred_language', 'pt_BR')
        }
        
        # Progressive context building based on task stage
        if task_stage == 'strategy':
            context = self._get_strategy_context(base_context)
        elif task_stage == 'products':
            context = self._get_products_context(base_context)
        elif task_stage == 'seo':
            context = self._get_seo_context(base_context)
        elif task_stage == 'content':
            context = self._get_content_context(base_context)
        elif task_stage == 'refinement':
            context = self._get_refinement_context(base_context)
        elif task_stage == 'review':
            context = self._get_review_context(base_context)
        elif task_stage == 'visual':
            context = self._get_visual_context(base_context)
        else:
            # Fallback to base context
            context = base_context
        
        # Agent-specific context adjustments
        context = self._adjust_for_agent(agent_role, context)
        
        # Cache the result
        self.context_cache[cache_key] = context
        
        return context
    
    def _get_strategy_context(self, base_context: Dict[str, Any]) -> Dict[str, Any]:
        """Context for strategy tasks (brand_strategist)"""
        return {
            **base_context,
            'benchmarks': self.full_context.get('benchmarks', ''),
            'blog': self.full_context.get('blog', ''),
            'format_recommendations': self.full_context.get('format_recommendations', '')
        }
    
    def _get_products_context(self, base_context: Dict[str, Any]) -> Dict[str, Any]:
        """Context for product identification tasks"""
        # Get strategy output if available
        strategy_output = self.full_context.get('strategy_output', '')
        
        return {
            **base_context,
            'products': self._limit_products(self.full_context.get('products', '')),
            'strategy_summary': self._summarize_strategy(strategy_output)
        }
    
    def _get_seo_context(self, base_context: Dict[str, Any]) -> Dict[str, Any]:
        """Context for SEO tasks (seo_specialist)"""
        return {
            **base_context,
            'products': self._limit_products(self.full_context.get('products', '')),
            'theme_keywords': self._limit_keywords(self.full_context.get('theme_keywords', [])),
            'keyword_opportunities': self._limit_keywords(self.full_context.get('keyword_opportunities', [])),
            'semantic_fields': self._summarize_semantic_fields(self.full_context.get('semantic_fields', {}))
        }
    
    def _get_content_context(self, base_context: Dict[str, Any]) -> Dict[str, Any]:
        """Context for content writing tasks (seo_blog_writer)"""
        return {
            **base_context,
            'products': self._limit_products(self.full_context.get('products', '')),
            'theme_keywords': self._limit_keywords(self.full_context.get('theme_keywords', [])),
            'keyword_opportunities': self._limit_keywords(self.full_context.get('keyword_opportunities', [])),
            'semantic_fields': self._summarize_semantic_fields(self.full_context.get('semantic_fields', {})),
            'format_recommendations': self.full_context.get('format_recommendations', ''),
            'blog': self.full_context.get('blog', ''),
            'brief_summary': self.full_context.get('brief_summary', ''),
            'reference_content': self.full_context.get('reference_content', '')  # Reference content for technical topics
        }
    
    def _get_refinement_context(self, base_context: Dict[str, Any]) -> Dict[str, Any]:
        """Context for narrative refinement tasks (narrative_editor)"""
        return {
            **base_context,
            'voice': self.full_context.get('voice', ''),
            'benchmarks': self.full_context.get('benchmarks', ''),
            'format_recommendations': self.full_context.get('format_recommendations', '')
        }
    
    def _get_review_context(self, base_context: Dict[str, Any]) -> Dict[str, Any]:
        """Context for content review tasks (content_reviewer)"""
        return {
            **base_context,
            'products': self._limit_products(self.full_context.get('products', '')),
            'voice': self.full_context.get('voice', '')
        }
    
    def _get_visual_context(self, base_context: Dict[str, Any]) -> Dict[str, Any]:
        """Context for visual consultant tasks (visual_consultant)"""
        return {
            **base_context,
            'brand': self.full_context.get('brand', ''),
            'voice': self.full_context.get('voice', '')
        }
    
    def _adjust_for_agent(self, agent_role: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Make agent-specific adjustments to context"""
        if agent_role == 'brand_strategist':
            # Brand strategist needs more brand context
            context['brand_context'] = {
                'brand': context.get('brand', ''),
                'voice': context.get('voice', ''),
                'benchmarks': context.get('benchmarks', '')
            }
        elif agent_role == 'seo_specialist':
            # SEO specialist needs keyword focus
            context['seo_focus'] = {
                'theme_keywords': context.get('theme_keywords', []),
                'keyword_opportunities': context.get('keyword_opportunities', [])
            }
        elif agent_role == 'seo_copywriter':
            # Blog writer needs content focus
            context['content_focus'] = {
                'format_recommendations': context.get('format_recommendations', ''),
                'semantic_fields': context.get('semantic_fields', {}),
                'reference_content': context.get('reference_content', '')  # Include reference content for technical accuracy
            }
        
        return context
    
    def _limit_products(self, products: str, max_products: int = 3) -> str:
        """Limit product information to reduce token usage"""
        if not products:
            return products
        
        # If products is a string, try to extract key information
        if isinstance(products, str):
            # Simple heuristic: take first few sentences or limit length
            sentences = products.split('.')
            limited_sentences = sentences[:max_products]
            return '. '.join(limited_sentences) + '.'
        
        return products
    
    def _limit_keywords(self, keywords: List[Dict], max_keywords: int = 5) -> List[Dict]:
        """Limit keyword data to reduce token usage"""
        if not keywords:
            return keywords
        
        # Sort by volume and take top keywords
        sorted_keywords = sorted(keywords, key=lambda x: x.get('Volume', 0), reverse=True)
        return sorted_keywords[:max_keywords]
    
    def _summarize_strategy(self, strategy_output: str) -> str:
        """Summarize strategy output to reduce token usage"""
        if not strategy_output:
            return ""
        
        # Take first 200 characters as summary
        summary = strategy_output[:200]
        if len(strategy_output) > 200:
            summary += "..."
        
        return summary
    
    def _summarize_semantic_fields(self, semantic_fields: Dict) -> Dict:
        """Summarize semantic fields to reduce token usage"""
        if not semantic_fields:
            return {}
        
        # For each theme, take only the most important semantic data
        summarized = {}
        for theme, data in semantic_fields.items():
            if isinstance(data, dict):
                # Take only key semantic information
                summarized[theme] = {
                    'related_google': data.get('related_google', [])[:5],  # Top 5 related keywords
                    'search_intent': data.get('search_intent', ''),
                    'suggested_titles': data.get('suggested_titles', [])[:3]  # Top 3 titles
                }
        
        return summarized
    
    def get_context_summary(self) -> Dict[str, Any]:
        """Get a summary of context usage for monitoring"""
        return {
            'total_contexts_generated': len(self.context_cache),
            'cache_keys': list(self.context_cache.keys()),
            'full_context_keys': list(self.full_context.keys())
        }


def create_context_chunker(inputs: Dict[str, Any]) -> ContextChunker:
    """
    Create a context chunker from crew inputs.
    
    Args:
        inputs: The full inputs dictionary from the crew
        
    Returns:
        ContextChunker instance
    """
    return ContextChunker(inputs)


def get_agent_context(agent_role: str, task_stage: str, chunker: ContextChunker) -> Dict[str, Any]:
    """
    Get optimized context for a specific agent and task stage.
    
    Args:
        agent_role: The agent's role
        task_stage: The current task stage
        chunker: ContextChunker instance
        
    Returns:
        Optimized context dictionary
    """
    return chunker.get_minimal_context(agent_role, task_stage)


# Task stage mapping for different agents
TASK_STAGE_MAPPING = {
    'brand_strategist': {
        'define_strategy': 'strategy',
        'identify_products': 'products'
    },
    'seo_specialist': {
        'map_opportunities': 'seo',
        'generate_seo_metafields': 'seo'
    },
    'content_strategist': {
        'plan_content': 'content'
    },
            'seo_blog_writer': {
        'write_content': 'content'
    },
    'narrative_editor': {
        'refine_narrative': 'refinement'
    },
    'content_reviewer': {
        'review_everything': 'review'
    },
    'visual_consultant': {
        'suggest_elements': 'visual'
    }
}


def get_task_stage(agent_role: str, task_name: str) -> str:
    """
    Get the task stage for a specific agent and task.
    
    Args:
        agent_role: The agent's role
        task_name: The task name
        
    Returns:
        Task stage string
    """
    return TASK_STAGE_MAPPING.get(agent_role, {}).get(task_name, 'general') 